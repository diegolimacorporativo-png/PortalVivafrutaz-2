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

dotenv.config();

const _bootAt = Date.now();
const _env = process.env.NODE_ENV ?? "development";

// T906 — Production Safe Mode: fail-fast on critical misconfigurations.
(function validateProductionEnv() {
  const isProd = process.env.NODE_ENV === "production";

  const validEnvs = ["development", "production", "test"];
  if (process.env.NODE_ENV && !validEnvs.includes(process.env.NODE_ENV)) {
    throw new Error(
      `NODE_ENV inválido: "${process.env.NODE_ENV}". Valores aceitos: ${validEnvs.join(", ")}`,
    );
  }

  if (isProd && !process.env.SUPABASE_DATABASE_URL) {
    throw new Error(
      "SUPABASE_DATABASE_URL é obrigatório em produção. Configure a variável de ambiente antes de iniciar.",
    );
  }

  if (isProd && process.env.DEBUG) {
    console.warn(
      `[T906][PROD_SAFE] DEBUG="${process.env.DEBUG}" detectado em produção — removido para evitar vazamento de internals.`,
    );
    delete process.env.DEBUG;
  }
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
  console.error("[UNHANDLED_REJECTION]", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    uptime: process.uptime().toFixed(1),
    env: _env,
  });
});

process.on("uncaughtException", (err: Error) => {
  console.error("[UNCAUGHT_EXCEPTION]", {
    message: err.message,
    stack: err.stack,
    uptime: process.uptime().toFixed(1),
    env: _env,
  });
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
  startOutboxWorker();
  startAutoDispatchWorker();
  startBillingCron();
  startAnalyticsWorker();
  startFaturamentoCron();
  startProactiveAlertsScheduler();
  initSchedulers();
  scheduleBackups();

  // Memory monitoring — log warning when heap exceeds 85% of total.
  const MEM_WARN_RATIO = 0.95;
  setInterval(() => {
    const m = process.memoryUsage();
    const heapRatio = m.heapUsed / m.heapTotal;
    const rssMB = (m.rss / 1024 / 1024).toFixed(2);
    const heapUsedMB = (m.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMB = (m.heapTotal / 1024 / 1024).toFixed(2);
    console.log(`[MEMORY] RSS: ${rssMB}MB, Heap Used: ${heapUsedMB}MB, Heap Total: ${heapTotalMB}MB`);
    if (heapRatio > MEM_WARN_RATIO) {
      console.warn("[MEMORY_WARNING]", {
        heapUsedMB,
        heapTotalMB,
        heapRatioPct: (heapRatio * 100).toFixed(1) + "%",
        rssMB,
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
      console.log("[WORKER_STOP]", { workers: ["outbox", "auto-dispatch"], ts: new Date().toISOString() });
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
