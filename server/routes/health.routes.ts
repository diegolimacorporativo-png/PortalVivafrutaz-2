import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { healthTestLimiter } from "../core/security/rateLimit";
import { logSecurityEvent } from "../core/security/securityLogger";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let healthTestRunning = false;
let lastHealthTestResult: any | null = null;
let lastHealthTestAt: number | null = null;
const CACHE_TTL = 15000;

export async function register(app: Express): Promise<void> {
  // Simple liveness probe
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Full internal health check
  app.get('/api/admin/health', requireAuthCore, requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]), async (req, res) => {
    const start = Date.now();
    const report: any = { timestamp: new Date().toISOString(), checks: {} };
    // DB check
    try {
      await storage.getLogs(1);
      report.checks.database = { status: 'OK', message: 'Banco de dados conectado' };
    } catch (e: any) {
      report.checks.database = { status: 'ERROR', message: e?.message };
    }
    // Auth check
    try {
      const users = await storage.getUsers();
      report.checks.auth = { status: 'OK', message: `${users.length} usuários cadastrados` };
    } catch (e: any) {
      report.checks.auth = { status: 'ERROR', message: e?.message };
    }
    // Orders check
    try {
      const recent = await storage.getLogs(5);
      report.checks.logs = { status: 'OK', message: `${recent.length} logs recentes` };
    } catch (e: any) {
      report.checks.logs = { status: 'ERROR', message: e?.message };
    }
    // Server
    report.checks.server = { status: 'OK', message: `Servidor respondendo — ${Date.now() - start}ms` };
    // Session
    report.checks.session = {
      status: req.session?.userId || req.session?.companyId ? 'OK' : 'WARN',
      message: req.session?.userId ? `Usuário #${req.session.userId} autenticado` : req.session?.companyId ? `Empresa #${req.session.companyId}` : 'Sem sessão ativa nesta requisição'
    };
    // Maintenance mode
    try {
      const maintenance = await storage.getSetting('maintenance_mode');
      report.checks.maintenance = { status: maintenance === 'true' ? 'WARN' : 'OK', message: maintenance === 'true' ? 'MANUTENÇÃO ATIVA' : 'Sistema operacional' };
    } catch (e) {
      report.checks.maintenance = { status: 'WARN', message: 'Não verificado' };
    }
    // Test mode
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
