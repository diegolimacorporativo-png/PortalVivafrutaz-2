import dotenv from "dotenv";
import { buildApp } from "./app";
import { serveStatic } from "./static";
import { getUser } from "./controllers/userController";
import { startOutboxWorker, stopOutboxWorker } from "./modules/orders/orders.outbox.worker";
import { startAutoDispatchWorker, stopAutoDispatchWorker } from "./modules/logistics/auto-dispatch.service";
import { startBillingCron } from "./modules/billing/billing.cron";
import { startFaturamentoCron } from "./jobs/faturamento.cron";
import { startAnalyticsWorker } from "./core/events/event-analytics.worker";
import { startProactiveAlertsScheduler } from "./services/alerts.proactive";
import { initSchedulers } from "./bootstrap/scheduler";
import { scheduleBackups } from "./backup";
import { pool } from "./database/db";
import { sql } from "drizzle-orm";
import { db } from "./database/db";
import { assertFiscalBootSafe, startFiscalRuntimeMonitor } from "./core/fiscal/homologation.guard";
import { ensureStorageBucket, backupMonitorStatus } from "./backup-storage.service";
import {
  startOperationalMonitor,
  stopOperationalMonitor,
  alertUncaughtException,
  alertUnhandledRejection,
} from "./core/alerts/operational-alerts.service";
import { authService } from "./modules/auth/auth.service";

dotenv.config();

const _bootAt = Date.now();
const _env = process.env.NODE_ENV ?? "development";

// T906 — Safe Mode: fail-fast on critical misconfigurations in ALL environments.
// SUPABASE_DATABASE_URL is mandatory regardless of NODE_ENV — no fallback to
// the Replit-managed DATABASE_URL (heliumdb) is ever permitted.
(function validateProductionEnv() {
  const isProd = process.env.NODE_ENV === "production";
  const fails: string[] = [];
  const warns: string[] = [];

  const validEnvs = ["development", "production", "test"];
  if (process.env.NODE_ENV && !validEnvs.includes(process.env.NODE_ENV)) {
    fails.push(`NODE_ENV inválido: "${process.env.NODE_ENV}". Valores aceitos: ${validEnvs.join(", ")}`);
  }

  // Obrigatório em TODOS os ambientes — não apenas produção.
  if (!process.env.SUPABASE_DATABASE_URL) {
    fails.push("SUPABASE_DATABASE_URL é obrigatório em todos os ambientes. Configure o secret e reinicie.");
  }

  // FISCAL BOOT SAFE — bloqueia NFE_SEFAZ_MODE=production antes de qualquer worker.
  assertFiscalBootSafe();

  if (isProd && process.env.DEBUG) {
    warns.push(`DEBUG="${process.env.DEBUG}" detectado em produção — removido.`);
    delete process.env.DEBUG;
  }

  if (fails.length > 0) {
    console.error("[BOOT_VALIDATION_FAIL]", {
      fails,
      env: process.env.NODE_ENV,
      pid: process.pid,
      uptime: process.uptime().toFixed(1),
      ts: new Date().toISOString(),
    });
    throw new Error(`Boot validation failed:\n${fails.join("\n")}`);
  }

  if (warns.length > 0) {
    warns.forEach(w => console.warn(`[T906][PROD_SAFE] ${w}`));
  }

  console.log("[BOOT_VALIDATION_OK]", {
    env: process.env.NODE_ENV ?? "development",
    provider: "supabase",
    supabase: true,
    pid: process.pid,
    ts: new Date().toISOString(),
  });
})();

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

async function recoverStuckNFes(): Promise<void> {
  try {
    const result = await db.execute(sql`
      UPDATE orders
      SET fiscal_status = 'erro'
      WHERE fiscal_status = 'enviando'
      RETURNING id
    `);
    const recovered = (result as any).rows?.length ?? 0;
    if (recovered > 0) {
      console.warn(`[NFE_STARTUP_RECOVERY] Recovered ${recovered} stuck NF-e(s) from 'enviando' → 'erro'`);
    }
  } catch (err) {
    console.error("[NFE_STARTUP_RECOVERY_FAIL]", err instanceof Error ? err.message : String(err));
  }
}

// Global unhandled error safety net — prevents silent crashes from async
// errors that escape all local try/catch blocks (e.g. in workers or timers).
// Logs structured info WITHOUT crashing for unhandledRejection (recoverable);
// flushes logs and exits for uncaughtException (process state is undefined).
process.on("unhandledRejection", (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error("[UNHANDLED_REJECTION]", {
    reason: msg,
    stack: reason instanceof Error ? reason.stack : undefined,
    uptime: process.uptime().toFixed(1),
    env: _env,
  });
  try { alertUnhandledRejection(msg); } catch {}
});

process.on("uncaughtException", (err: Error) => {
  console.error("[UNCAUGHT_EXCEPTION]", {
    message: err.message,
    stack: err.stack,
    uptime: process.uptime().toFixed(1),
    env: _env,
  });
  try { alertUncaughtException(err.message); } catch {}
  // uncaughtException leaves the process in an undefined state — exit safely.
  process.exit(1);
});

(async () => {
  console.log("[APP_BOOT]", {
    env: _env,
    pid: process.pid,
    node: process.version,
    ts: new Date().toISOString(),
  });

  const { app, httpServer } = await buildApp();

  // Probe DB connectivity and log result at boot.
  try {
    await pool.query("SELECT 1 AS ok");
    console.log("[DB_CONNECTED]", {
      db: process.env.SUPABASE_DATABASE_URL ? "supabase" : "replit",
      uptime: process.uptime().toFixed(1),
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[DB_CONNECTION_FAIL]", {
      message: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    });
  }

  await recoverStuckNFes();

  // ETAPA 2 — DESBLOQUEIO IMEDIATO: reset is_locked + login_attempts for all
  // MASTER/ADMIN/DIRECTOR/DEVELOPER accounts and pre-register their emails in
  // the loginEmailIpLimiter bypass set. Fail-safe — never throws.
  await authService.unlockStrategicAccounts();
  app.get("/user", getUser);
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // FASE 1.8 — Pre-warm XSD NF-e 4.00 cache on boot.
  import('./services/nfe/nfeXsdValidator').then(({ warmupXsdCache }) => {
    warmupXsdCache();
  }).catch((err) => {
    console.warn('[NFE_XSD_WARMUP_IMPORT_FAIL]', err?.message);
  });

  console.log("[WORKER_START]", { workers: ["outbox", "auto-dispatch", "billing", "faturamento", "proactive-alerts", "schedulers", "backup"], ts: new Date().toISOString() });
  startFiscalRuntimeMonitor(300_000);
  startOutboxWorker();
  startAutoDispatchWorker();
  startBillingCron();
  startAnalyticsWorker();
  startFaturamentoCron();
  startProactiveAlertsScheduler();
  initSchedulers();
  scheduleBackups();

  // BACKUP PERSISTENTE — inicializa bucket Supabase e status do monitor.
  ensureStorageBucket().catch(e => console.warn("[BACKUP_STORAGE_INIT_FAIL]", e?.message));
  backupMonitorStatus().catch(e => console.warn("[BACKUP_MONITOR_INIT_FAIL]", e?.message));

  // ALERTAS OPERACIONAIS — probe periódico a cada 60s: DB, fila, memória,
  // circuit breaker, workers, backup. Dedup + cooldown em memória.
  startOperationalMonitor(60_000);

  // Memory monitoring — log [MEMORY_WARNING] when RSS exceeds 1 GB.
  // RSS is the real OS-level memory consumption; heapPct is misleading because
  // V8 grows heapTotal lazily (97% heap before a GC cycle is normal behaviour,
  // not OOM). A 1 GB RSS threshold catches actual memory pressure.
  const RSS_WARN_MB = 1024;
  setInterval(() => {
    const m = process.memoryUsage();
    const rssMB = (m.rss / 1024 / 1024).toFixed(2);
    const heapUsedMB = (m.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMB = (m.heapTotal / 1024 / 1024).toFixed(2);
    const heapPct = ((m.heapUsed / m.heapTotal) * 100).toFixed(1) + "%";
    console.log(`[MEMORY] RSS: ${rssMB}MB, Heap: ${heapUsedMB}/${heapTotalMB}MB (${heapPct})`);
    if (m.rss / 1024 / 1024 > RSS_WARN_MB) {
      console.warn("[MEMORY_WARNING]", {
        rssMB,
        heapUsedMB,
        heapTotalMB,
        heapPct,
        thresholdMB: RSS_WARN_MB,
        uptime: process.uptime().toFixed(1),
        env: _env,
        ts: new Date().toISOString(),
      });
    }
  }, 60_000);

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0" }, () => {
    const bootMs = Date.now() - _bootAt;
    console.log(`serving on port ${port}`);
    console.log("[APP_READY]", {
      port,
      env: _env,
      pid: process.pid,
      bootMs,
      uptime: process.uptime().toFixed(1),
      db: process.env.SUPABASE_DATABASE_URL ? "supabase" : "replit",
      ts: new Date().toISOString(),
    });
  });

  async function shutdown(signal: string) {
    console.log("[APP_SHUTDOWN]", {
      signal,
      uptime: process.uptime().toFixed(1),
      env: _env,
      pid: process.pid,
      ts: new Date().toISOString(),
    });

    // Stop workers that have explicit stop functions first to prevent
    // mid-batch interruptions and stale job-registry entries.
    try {
      stopOutboxWorker();
      stopAutoDispatchWorker();
      stopOperationalMonitor();
      console.log("[WORKER_STOP]", { workers: ["outbox", "auto-dispatch", "operational-monitor"], ts: new Date().toISOString() });
    } catch (err) {
      console.error("[WORKER_STOP_ERROR]", err instanceof Error ? err.message : String(err));
    }

    httpServer.close(async () => {
      console.log("HTTP server closed, draining DB pool...");
      try {
        await pool.end();
        console.log("DB pool drained — exiting cleanly");
      } catch (err) {
        console.error("[SHUTDOWN_POOL_ERROR]", err);
      }
      process.exit(0);
    });

    setTimeout(() => {
      console.error("[SHUTDOWN_TIMEOUT] Graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, 15_000).unref();
  }

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
})().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
