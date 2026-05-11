import dotenv from "dotenv";
import { buildApp } from "./app";
import { serveStatic } from "./static";
import { getUser } from "./controllers/userController";
import { startOutboxWorker } from "./modules/orders/orders.outbox.worker";
import { startAutoDispatchWorker } from "./modules/logistics/auto-dispatch.service";
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

(async () => {
  const { app, httpServer } = await buildApp();
  await recoverStuckNFes();
  app.get("/user", getUser);
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }
  startOutboxWorker();
  startAutoDispatchWorker();
  startBillingCron();
  startAnalyticsWorker();
  startFaturamentoCron();
  startProactiveAlertsScheduler();
  initSchedulers();
  scheduleBackups();
  setInterval(() => {
    const m = process.memoryUsage();
    console.log(`[MEMORY] RSS: ${(m.rss / 1024 / 1024).toFixed(2)}MB, Heap Used: ${(m.heapUsed / 1024 / 1024).toFixed(2)}MB, Heap Total: ${(m.heapTotal / 1024 / 1024).toFixed(2)}MB`);
  }, 60_000);
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0" }, () => {
    console.log(`serving on port ${port}`);
  });
  async function shutdown(signal: string) {
    console.log(`${signal} received — starting graceful shutdown`);
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
