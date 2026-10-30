import dotenv from "dotenv";
import { buildApp } from "./app";
import { serveStatic } from "./static";
import { getUser } from "./controllers/userController";
import { startOutboxWorker, stopOutboxWorker } from "./modules/orders/orders.outbox.worker";
import { startAutoDispatchWorker, stopAutoDispatchWorker } from "./modules/logistics/auto-dispatch.service";
import { startBillingCron } from "./modules/billing/billing.cron";
import { startFaturamentoCron } from "./jobs/faturamento.cron";
import { startRecurringOrdersCron } from "./jobs/recurring-orders.cron";
import { startAnalyticsWorker } from "./core/events/event-analytics.worker";
import { startProactiveAlertsScheduler } from "./services/alerts.proactive";
import { initSchedulers } from "./bootstrap/scheduler";
import { scheduleBackups } from "./backup";
import { pool } from "./database/db";
import { assertFiscalBootSafe, startFiscalRuntimeMonitor } from "./core/fiscal/homologation.guard";
import { backupMonitorStatus } from "./backup-storage.service";
import {
  startOperationalMonitor,
  stopOperationalMonitor,
  alertUncaughtException,
  alertUnhandledRejection,
} from "./core/alerts/operational-alerts.service";
import { authService } from "./modules/auth/auth.service";
import {
  getRuntimeDatabaseProvider,
  getRuntimeDatabaseUrl,
  isIsolatedRuntimeMode,
  isRemoteHomologationMode,
  validateRemoteHomologationConfig,
  verifyRemoteHomologationDatabaseIdentity,
} from "./core/runtimeMode";
import { assertStartupSchemaReady } from "./bootstrap/startup-schema";

if (!isIsolatedRuntimeMode()) {
  dotenv.config();
}

const _bootAt = Date.now();
const _env = process.env.NODE_ENV ?? "development";

// T906 — Safe Mode: fail-fast on critical misconfigurations in ALL environments.
// A PostgreSQL URL must be provided through SUPABASE_DATABASE_URL or DATABASE_URL.
// The Replit-managed DATABASE_URL (heliumdb) is never permitted.
(function validateProductionEnv() {
  const isProd = process.env.NODE_ENV === "production";
  const fails: string[] = [];
  const warns: string[] = [];

  const validEnvs = ["development", "production", "test"];
  if (process.env.NODE_ENV && !validEnvs.includes(process.env.NODE_ENV)) {
    fails.push(`NODE_ENV inválido: "${process.env.NODE_ENV}". Valores aceitos: ${validEnvs.join(", ")}`);
  }

  let databaseUrl = "";
  try {
    databaseUrl = getRuntimeDatabaseUrl();
  } catch (error) {
    fails.push(error instanceof Error ? error.message : "URL do banco inválida.");
  }

  if (!databaseUrl) {
    if (!isIsolatedRuntimeMode()) {
      fails.push("SUPABASE_DATABASE_URL ou DATABASE_URL é obrigatório em todos os ambientes. Configure o secret e reinicie.");
    }
  } else if (!isIsolatedRuntimeMode()) {
    const blockedDatabaseUrlPatterns: Array<{ pattern: RegExp; reason: string }> = [
      { pattern: /heliumdb/i, reason: "banco Replit (heliumdb) proibido" },
      { pattern: /localhost/i, reason: "PostgreSQL local proibido" },
      { pattern: /127\.0\.0\.1/i, reason: "PostgreSQL local proibido" },
      { pattern: /^(?!postgresql:\/\/|postgres:\/\/)/i, reason: "protocolo não-PostgreSQL proibido" },
    ];

    for (const { pattern, reason } of blockedDatabaseUrlPatterns) {
      if (pattern.test(databaseUrl)) {
        fails.push(`URL do banco inválida: ${reason}.`);
      }
    }
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
    provider: getRuntimeDatabaseProvider(),
    supabase: !isIsolatedRuntimeMode(),
    pid: process.pid,
    ts: new Date().toISOString(),
  });
})();

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
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
  if (!isIsolatedRuntimeMode()) {
    try { alertUnhandledRejection(msg); } catch {}
  }
});

process.on("uncaughtException", (err: Error) => {
  console.error("[UNCAUGHT_EXCEPTION]", {
    message: err.message,
    stack: err.stack,
    uptime: process.uptime().toFixed(1),
    env: _env,
  });
  if (!isIsolatedRuntimeMode()) {
    try { alertUncaughtException(err.message); } catch {}
  }
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

  let builtApplication: Awaited<ReturnType<typeof buildApp>> | undefined;
  if (!isRemoteHomologationMode()) {
    // Preserve the existing startup order for production and the local preview.
    builtApplication = await buildApp();
  }

  // Probe DB connectivity and verify the pre-provisioned schema. Startup is
  // read-only; schema changes and data recovery use explicit operator commands.
  try {
    await pool.query("SELECT 1 AS ok");
    if (isRemoteHomologationMode()) {
      const remoteIdentity = await verifyRemoteHomologationDatabaseIdentity(
        (text) => pool.query(text),
        validateRemoteHomologationConfig(),
      );
      console.info("[REMOTE_HOMOLOGATION_DB_IDENTITY_VERIFIED]", {
        projectRef: remoteIdentity.projectRef,
        environment: remoteIdentity.environment,
        database: remoteIdentity.database,
        schema: remoteIdentity.schema,
        markerVerified: true,
      });
    }
    await assertStartupSchemaReady((text) => pool.query(text));
    console.log("[DB_CONNECTED]", {
      db: getRuntimeDatabaseProvider(),
      uptime: process.uptime().toFixed(1),
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[DB_CONNECTION_FAIL]", {
      message: isRemoteHomologationMode()
        ? "Remote homologation PostgreSQL identity or readiness check failed."
        : err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    });
    throw err;
  }

  if (isIsolatedRuntimeMode()) {
    console.info("[ISOLATED_PREVIEW] Runtime migrations, NF-e recovery, account unlocks, and seeds are disabled.");
  } else {
    // A read-only lookup populates the in-memory login limiter bypass. Any
    // account unlock/reset is an explicit maintenance operation.
    await authService.registerStrategicAccountsForLoginBypass();
  }
  if (isRemoteHomologationMode()) {
    // Do not register the API or its session store until PostgreSQL identity
    // has been attested against the isolated project marker.
    builtApplication = await buildApp();
  }
  if (!builtApplication) throw new Error("Aplicação não foi inicializada.");
  const { app, httpServer } = builtApplication;
  app.get("/user", getUser);
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  if (isIsolatedRuntimeMode()) {
    console.info(
      "[ISOLATED_PREVIEW] workers, schedulers, backup/storage checks, and NF-e warmup are disabled.",
    );
  } else {
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
    startRecurringOrdersCron();
    startProactiveAlertsScheduler();
    initSchedulers();
    scheduleBackups();

    // Read backup monitor state only. The backup pipeline owns bucket checks.
    backupMonitorStatus().catch(e => console.warn("[BACKUP_MONITOR_INIT_FAIL]", e?.message));

    // ALERTAS OPERACIONAIS — probe periódico a cada 60s: DB, fila, memória,
    // circuit breaker, workers, backup. Dedup + cooldown em memória.
    startOperationalMonitor(60_000);
  }

  // Memory monitoring — log [MEMORY_WARNING] when RSS exceeds 1 GB.
  // RSS is the real OS-level memory consumption; heapPct is misleading because
  // V8 grows heapTotal lazily (97% heap before a GC cycle is normal behaviour,
  // not OOM). A 1 GB RSS threshold catches actual memory pressure.
  const RSS_WARN_MB = 1024;
  if (!isIsolatedRuntimeMode()) setInterval(() => {
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
  }, 60_000).unref();

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: isRemoteHomologationMode() ? "127.0.0.1" : "0.0.0.0" }, () => {
    const bootMs = Date.now() - _bootAt;
    console.log(`serving on port ${port}`);
    console.log("[APP_READY]", {
      port,
      env: _env,
      pid: process.pid,
      bootMs,
      uptime: process.uptime().toFixed(1),
      db: getRuntimeDatabaseProvider(),
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
      if (!isIsolatedRuntimeMode()) {
        stopOutboxWorker();
        stopAutoDispatchWorker();
        stopOperationalMonitor();
        console.log("[WORKER_STOP]", { workers: ["outbox", "auto-dispatch", "operational-monitor"], ts: new Date().toISOString() });
      }
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
