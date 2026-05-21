/**
 * ETAPA 5 — GET /api/admin/system-status
 *
 * Single read-only endpoint that returns a comprehensive runtime snapshot:
 *   uptime, heap, rss, event-loop lag, postgres latency + pool stats,
 *   worker registry, env, tpAmb (from DB), version.
 *
 * Access: MASTER | ADMIN | DEVELOPER | DIRECTOR
 * No mutations. Always returns 200 (degraded checks appear inside the body).
 */

import type { Express } from "express";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import { pool, db } from "../database/db";
import { sql } from "drizzle-orm";
import { performance } from "perf_hooks";
import { getJobRegistry } from "../core/jobs/job-registry";
import { getCircuitState } from "../services/nfe/sefazCircuitBreaker";
import { alertEventLoopLag, emitAlert, resolveAlert } from "../core/alerts/operational-alerts.service";

const _bootAt = Date.now();

async function measureEventLoopLag(): Promise<number> {
  const t0 = performance.now();
  await new Promise<void>((resolve) => setImmediate(resolve));
  return parseFloat((performance.now() - t0).toFixed(2));
}

async function measurePostgresLatency(): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const t0 = performance.now();
  try {
    await Promise.race([
      pool.query("SELECT 1 AS ok"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT_3S")), 3000),
      ),
    ]);
    const latencyMs = parseFloat((performance.now() - t0).toFixed(2));
    if (latencyMs > 1000) {
      console.warn("[DB_LATENCY_WARN]", { latencyMs, ts: new Date().toISOString() });
      try {
        emitAlert(
          "postgres.latency.high",
          latencyMs > 3000 ? "CRITICAL" : "WARN",
          "Latência PostgreSQL alta",
          `Supabase respondeu em ${latencyMs.toFixed(0)}ms (threshold: 1000ms)`,
          { latencyMs: Math.round(latencyMs), source: "system-status" },
        );
      } catch {}
    } else {
      try { resolveAlert("postgres.latency.high", `latência OK: ${latencyMs.toFixed(0)}ms`); } catch {}
    }
    return { ok: true, latencyMs, message: "OK" };
  } catch (err) {
    return {
      ok: false,
      latencyMs: parseFloat((performance.now() - t0).toFixed(2)),
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function getTpAmb(): Promise<string> {
  try {
    // Returns 'producao' if any company is configured for production fiscal.
    // Anything else means all tenants are in homologação.
    const result = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM empresa_config
      WHERE ambiente_fiscal = 'producao'
    `);
    const cnt = parseInt((result as any).rows?.[0]?.cnt ?? "0", 10);
    return cnt > 0 ? "MIXED — some tenants in producao" : "2 (homologacao — all tenants)";
  } catch {
    return "unknown (DB query failed)";
  }
}

async function getQueueBacklog(): Promise<{ pending: number; deadLetter: number }> {
  try {
    // workflow_events is the real transactional outbox table.
    // pending  = not yet processed (processed_at IS NULL) and not dead-lettered.
    // dead_letter = permanently failed events (dead_letter=true column).
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE processed_at IS NULL AND dead_letter = false) AS pending,
        COUNT(*) FILTER (WHERE dead_letter = true)                           AS dead_letter
      FROM workflow_events
    `);
    const row = (result as any).rows?.[0] ?? {};
    const pending = parseInt(row.pending ?? "0", 10);
    const deadLetter = parseInt(row.dead_letter ?? "0", 10);
    if (pending > 100) {
      console.warn("[QUEUE_BACKLOG_WARN]", { pending, ts: new Date().toISOString() });
    }
    return { pending, deadLetter };
  } catch {
    return { pending: -1, deadLetter: -1 };
  }
}

export function register(app: Express): void {
  app.get(
    "/api/admin/system-status",
    requireAuth,
    requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]),
    async (_req, res) => {
      const t0 = performance.now();

      const [dbCheck, evtLoopLag, queueBacklog, tpAmb] = await Promise.all([
        measurePostgresLatency(),
        measureEventLoopLag(),
        getQueueBacklog(),
        getTpAmb(),
      ]);

      const mem = process.memoryUsage();
      const heapPct = ((mem.heapUsed / mem.heapTotal) * 100).toFixed(1) + "%";

      // Pool connection stats (pg internal properties — best-effort)
      const poolStats = {
        total: (pool as any).totalCount ?? (pool as any)._clients?.length ?? -1,
        idle: (pool as any).idleCount ?? -1,
        waiting: (pool as any).waitingCount ?? -1,
      };

      // Job registry snapshot — active/recent jobs
      const jobs = getJobRegistry();

      // SEFAZ circuit breaker state
      const circuitState = (() => {
        try { return getCircuitState(); } catch { return "unknown"; }
      })();

      const uptimeSec = parseFloat(process.uptime().toFixed(2));

      const payload = {
        status: dbCheck.ok ? "operational" : "degraded",
        env: process.env.NODE_ENV ?? "development",
        pid: process.pid,
        uptime: uptimeSec,
        bootAt: new Date(_bootAt).toISOString(),
        ts: new Date().toISOString(),
        memory: {
          rssMB: parseFloat((mem.rss / 1024 / 1024).toFixed(1)),
          heapUsedMB: parseFloat((mem.heapUsed / 1024 / 1024).toFixed(1)),
          heapTotalMB: parseFloat((mem.heapTotal / 1024 / 1024).toFixed(1)),
          heapPct,
          externalMB: parseFloat((mem.external / 1024 / 1024).toFixed(1)),
        },
        eventLoop: {
          lagMs: evtLoopLag,
          warning: evtLoopLag > 100,
        },
        database: {
          ok: dbCheck.ok,
          latencyMs: dbCheck.latencyMs,
          message: dbCheck.message,
          pool: poolStats,
          provider: process.env.SUPABASE_DATABASE_URL ? "supabase" : "replit",
        },
        fiscal: {
          tpAmb,
          circuitBreaker: circuitState,
        },
        queue: {
          outboxPending: queueBacklog.pending,
          outboxDeadLetter: queueBacklog.deadLetter,
          warning: queueBacklog.pending > 100,
        },
        jobs,
        node: process.version,
        responseMs: parseFloat((performance.now() - t0).toFixed(2)),
      };

      console.log("[SYSTEM_STATUS]", {
        status: payload.status,
        uptime: uptimeSec,
        heapPct,
        dbLatencyMs: dbCheck.latencyMs,
        evtLoopLagMs: evtLoopLag,
        queuePending: queueBacklog.pending,
        ts: payload.ts,
      });

      if (evtLoopLag > 100) {
        console.warn("[EVENT_LOOP_LAG]", { lagMs: evtLoopLag, uptime: uptimeSec, ts: payload.ts });
      }
      try { alertEventLoopLag(evtLoopLag); } catch {}

      res.status(200).json({ success: true, data: payload });
    },
  );
}
