import dotenv from "dotenv";
import { buildApp } from "./app";
import { serveStatic } from "./static";
import { getUser } from "./controllers/userController";
import { startOutboxWorker } from "./modules/orders/orders.outbox.worker";
import { startAutoDispatchWorker } from "./modules/logistics/auto-dispatch.service";
import { startBillingCron } from "./modules/billing/billing.cron";
import { startFaturamentoCron } from "./jobs/faturamento.cron";
// STEP 9.3F.9 — alertas proativos automatizados (reusa buildInsights + emitAlertSmart).
import { startProactiveAlertsScheduler } from "./services/alerts.proactive";
import { initSchedulers } from "./bootstrap/scheduler";
import { pool } from "./database/db";
import { sql } from "drizzle-orm";
import { db } from "./database/db";

/**
 * Bootstrap.
 *
 * Architecture decision: this file does the absolute minimum — load env,
 * build the Express app via the factory, attach the dev/prod static layer,
 * and start listening. Anything else belongs in `app.ts` or a module.
 */
dotenv.config();

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

/**
 * BUG-09-FIX: Startup recovery for NF-es stuck in 'enviando' state.
 *
 * If the process crashed while transmitting to SEFAZ, orders can be
 * permanently stuck with fiscal_status = 'enviando'. On startup, any order
 * that has been in this state for more than 30 minutes is transitioned to
 * 'erro' so the operator can re-attempt emission manually.
 */
async function recoverStuckNFes(): Promise<void> {
  try {
    // Any order in 'enviando' at startup is genuinely stuck — no active
    // SEFAZ transmission can survive a process restart. Reset all of them
    // to 'erro' so operators can retry emission manually.
    // (The orders table has no updated_at column — the crash-recovery
    //  heuristic is: if the server is booting, the prior transmission died.)
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
    // Non-fatal: if the recovery query fails, log and continue.
    console.error("[NFE_STARTUP_RECOVERY_FAIL]", err instanceof Error ? err.message : String(err));
  }
}

(async () => {
  const { app, httpServer } = await buildApp();

  // BUG-09-FIX: recover NF-es stuck in 'enviando' before accepting traffic.
  await recoverStuckNFes();

  // Legacy single-route endpoint kept for backwards compatibility.
  app.get("/user", getUser);

  // Static or Vite — must come AFTER all API routes so the catch-all
  // doesn't shadow them.
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Workflow event outbox worker — processes side-effects asynchronously
  // (push notifications, audit logs) with retry semantics.
  startOutboxWorker();

  // Auto-dispatch worker — periodically attaches pending deliveries to the
  // cheapest existing route via the shared `suggestInsertion` optimiser.
  startAutoDispatchWorker();

  // Billing cron — daily check for overdue invoices and downgrade to free.
  startBillingCron();

  // Faturamento cron — STEP 9.3C: emissão automática às 08:00 (controlada por AUTO_FATURAMENTO flag).
  startFaturamentoCron();

  // STEP 9.3F.9 — alertas proativos: a cada 10min, dispara emitAlertSmart
  // para insights CRITICAL retornados por buildInsights. Sem nova lógica.
  startProactiveAlertsScheduler();

  // Email scheduler (window open + unfinalised reminders) — FASE 8.8A: moved
  // out of routes.ts into bootstrap so routes.ts has zero runtime side-effects.
  initSchedulers();

  // Memory monitor — useful in production to catch leaks early.
  setInterval(() => {
    const m = process.memoryUsage();
    console.log(
      `[MEMORY] RSS: ${(m.rss / 1024 / 1024).toFixed(2)}MB, Heap Used: ${(m.heapUsed / 1024 / 1024).toFixed(2)}MB, Heap Total: ${(m.heapTotal / 1024 / 1024).toFixed(2)}MB`,
    );
  }, 60_000);

  // Replit always serves on the single non-firewalled port (default 5000).
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0" }, () => {
    log(`serving on port ${port}`);
  });

  // Graceful shutdown — SIGTERM from container orchestrator or `npm stop`.
  // Close the HTTP server first (stop accepting new connections), then
  // drain the DB connection pool so in-flight queries can finish cleanly.
  async function shutdown(signal: string) {
    log(`${signal} received — starting graceful shutdown`);
    httpServer.close(async () => {
      log("HTTP server closed, draining DB pool...");
      try {
        await pool.end();
        log("DB pool drained — exiting cleanly");
      } catch (err) {
        console.error("[SHUTDOWN_POOL_ERROR]", err);
      }
      process.exit(0);
    });

    // Safety net: force-exit after 15 s if graceful close hangs.
    setTimeout(() => {
      console.error("[SHUTDOWN_TIMEOUT] Graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, 15_000).unref();
  }

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT",  () => void shutdown("SIGINT"));
})().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
