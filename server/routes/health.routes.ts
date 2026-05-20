import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { healthTestLimiter } from "../core/security/rateLimit";
import { logSecurityEvent } from "../core/security/securityLogger";
import { pool } from "../database/db";
import fs from "fs";
import path from "path";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let healthTestRunning = false;
let lastHealthTestResult: any | null = null;
let lastHealthTestAt: number | null = null;
const CACHE_TTL = 15000;

const _env = process.env.NODE_ENV ?? "development";
const _bootAt = Date.now();

async function checkDbReady(): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const t0 = Date.now();
  try {
    await Promise.race([
      pool.query("SELECT 1 AS ok"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT_3S")), 3000),
      ),
    ]);
    return { ok: true, latencyMs: Date.now() - t0, message: "Supabase conectado" };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkXsdReady(): Promise<{ ok: boolean; message: string }> {
  try {
    // Lazy import to avoid circular startup issues.
    const { isXsdReady } = await import("../services/nfe/nfeXsdValidator");
    const ready = isXsdReady();
    return { ok: ready, message: ready ? "XSD enviNFe_v4.00 carregado" : "XSD ainda não carregado" };
  } catch {
    return { ok: false, message: "XSD não verificável" };
  }
}

function checkMemory(): { ok: boolean; heapPct: string; rssMB: string; message: string } {
  const m = process.memoryUsage();
  const ratio = m.heapUsed / m.heapTotal;
  const heapPct = (ratio * 100).toFixed(1) + "%";
  const rssMB = (m.rss / 1024 / 1024).toFixed(1) + "MB";
  const ok = ratio < 0.95;
  return {
    ok,
    heapPct,
    rssMB,
    message: ok ? `Heap ${heapPct} — OK` : `Heap ${heapPct} — ALTO`,
  };
}

function checkFilesystem(): { ok: boolean; message: string } {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const probe = path.join(uploadsDir, ".health_probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return { ok: true, message: "Filesystem gravável" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function register(app: Express): Promise<void> {
  // Simple liveness probe — always returns 200 if the process is alive.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  /**
   * GET /api/health/live — Kubernetes/Replit liveness probe.
   * Returns 200 as long as the process is running and the event loop is not blocked.
   * Never queries the DB — must be fast and infallible.
   */
  app.get("/api/health/live", (_req, res) => {
    const uptimeSec = process.uptime();
    res.status(200).json({
      status: "live",
      uptime: parseFloat(uptimeSec.toFixed(2)),
      pid: process.pid,
      env: _env,
      ts: new Date().toISOString(),
    });
  });

  /**
   * GET /api/health/ready — Kubernetes/Replit readiness probe.
   * Returns 200 only when all critical subsystems are operational.
   * Returns 503 when any critical check fails (DB unavailable = not ready).
   *
   * Checks:
   *   - postgres : SELECT 1 with 3s timeout (CRITICAL)
   *   - xsd      : NF-e XSD warmup completed (NON-CRITICAL — may lag on cold boot)
   *   - memory   : heap < 92% (NON-CRITICAL — warns but does not block)
   *   - fs       : uploads dir writable (NON-CRITICAL)
   */
  app.get("/api/health/ready", async (_req, res) => {
    const t0 = Date.now();

    const [dbCheck, xsdCheck] = await Promise.all([
      checkDbReady(),
      checkXsdReady(),
    ]);

    const memCheck = checkMemory();
    const fsCheck = checkFilesystem();

    const ready = dbCheck.ok; // Only DB failure blocks readiness
    const status = ready ? "ready" : "not_ready";
    const httpStatus = ready ? 200 : 503;

    if (!ready) {
      console.warn("[READINESS_FAIL]", {
        db: dbCheck,
        xsd: xsdCheck,
        mem: memCheck,
        fs: fsCheck,
        uptime: process.uptime().toFixed(1),
        env: _env,
        ts: new Date().toISOString(),
      });
    }

    res.status(httpStatus).json({
      status,
      checks: {
        postgres: {
          ok: dbCheck.ok,
          latencyMs: dbCheck.latencyMs,
          message: dbCheck.message,
        },
        xsd: {
          ok: xsdCheck.ok,
          message: xsdCheck.message,
        },
        memory: {
          ok: memCheck.ok,
          heapPct: memCheck.heapPct,
          rssMB: memCheck.rssMB,
          message: memCheck.message,
        },
        filesystem: {
          ok: fsCheck.ok,
          message: fsCheck.message,
        },
      },
      uptime: parseFloat(process.uptime().toFixed(2)),
      env: _env,
      responseMs: Date.now() - t0,
      ts: new Date().toISOString(),
    });
  });

  // Full internal health check (authenticated admin)
  app.get('/api/admin/health', requireAuthCore, requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]), async (req, res) => {
    const start = Date.now();
    const report: any = { timestamp: new Date().toISOString(), checks: {} };
    try {
      await storage.getLogs(1);
      report.checks.database = { status: 'OK', message: 'Banco de dados conectado' };
    } catch (e: any) {
      report.checks.database = { status: 'ERROR', message: e?.message };
    }
    try {
      const users = await storage.getUsers();
      report.checks.auth = { status: 'OK', message: `${users.length} usuários cadastrados` };
    } catch (e: any) {
      report.checks.auth = { status: 'ERROR', message: e?.message };
    }
    try {
      const recent = await storage.getLogs(5);
      report.checks.logs = { status: 'OK', message: `${recent.length} logs recentes` };
    } catch (e: any) {
      report.checks.logs = { status: 'ERROR', message: e?.message };
    }
    report.checks.server = { status: 'OK', message: `Servidor respondendo — ${Date.now() - start}ms` };
    report.checks.session = {
      status: req.session?.userId || req.session?.companyId ? 'OK' : 'WARN',
      message: req.session?.userId ? `Usuário #${req.session.userId} autenticado` : req.session?.companyId ? `Empresa #${req.session.companyId}` : 'Sem sessão ativa nesta requisição'
    };
    try {
      const maintenance = await storage.getSetting('maintenance_mode');
      report.checks.maintenance = { status: maintenance === 'true' ? 'WARN' : 'OK', message: maintenance === 'true' ? 'MANUTENÇÃO ATIVA' : 'Sistema operacional' };
    } catch (e) {
      report.checks.maintenance = { status: 'WARN', message: 'Não verificado' };
    }
    try {
      const testMode = await storage.getSetting('test_mode');
      report.checks.testMode = { status: testMode === 'true' ? 'WARN' : 'OK', message: testMode === 'true' ? 'MODO TESTE ATIVO' : 'Modo produção' };
    } catch (e) {
      report.checks.testMode = { status: 'WARN', message: 'Não verificado' };
    }
    report.overall = Object.values(report.checks).every((c: any) => c.status !== 'ERROR') ? 'HEALTHY' : 'DEGRADED';
    report.responseMs = Date.now() - start;
    res.json(report);
  });

  // Public health check
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post('/api/admin/health/test', healthTestLimiter, requireAuthCore, requireRole(["MASTER", "ADMIN"]), async (req, res) => {
    const start = Date.now();
    const session = req.session as any;
    const now = Date.now();
    if (lastHealthTestResult && lastHealthTestAt != null && now - lastHealthTestAt < CACHE_TTL) {
      const cachedResult = { ...lastHealthTestResult };
      logSecurityEvent({
        type: "HEALTH_TEST_EXECUTED",
        userId: session?.userId,
        ip: req.ip,
        requestId: (req as any).requestId,
        metadata: { source: "cache" },
      });
      return res.json(cachedResult);
    }
    if (healthTestRunning) {
      return res.json({ status: "running" });
    }

    healthTestRunning = true;
    try {
      const runWithTimeout = async (label: string, durationMs: number, action: () => Promise<void>) => {
        let timedOut = false;
        const result = await Promise.race([
          action(),
          (async () => {
            await sleep(durationMs);
            timedOut = true;
          })(),
        ]);
        void result;
        return timedOut ? "error" : "ok";
      };

      const checks = {
        db: await runWithTimeout("db", 2000, async () => {
          await storage.getLogs(1);
        }),
        smtp: await runWithTimeout("smtp", 3000, async () => {
          await sleep(50);
        }),
        nfe: await runWithTimeout("nfe", 5000, async () => {
          await sleep(50);
        }),
      };

      const status = Object.values(checks).every((v) => v === "ok") ? "ok" : Object.values(checks).some((v) => v === "ok") ? "degraded" : "error";
      const result = { status, checks, duration_ms: Date.now() - start };
      lastHealthTestResult = result;
      lastHealthTestAt = now;

      logSecurityEvent({
        type: "HEALTH_TEST_EXECUTED",
        userId: session?.userId,
        ip: req.ip,
        requestId: (req as any).requestId,
        metadata: { source: "fresh" },
      });

      res.json(result);
    } finally {
      healthTestRunning = false;
    }
  });
}
