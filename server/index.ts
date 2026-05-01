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

(async () => {
  const { app, httpServer } = await buildApp();

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
})().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
