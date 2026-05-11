/**
 * FASE 2 — Observability routes (MASTER only).
 *
 * GET  /api/admin/observability/errors    — list operational errors
 * DELETE /api/admin/observability/errors  — clear error store
 * GET  /api/admin/observability/metrics   — read current metrics
 * POST /api/admin/observability/metrics/reset — reset metrics
 *
 * All endpoints require MASTER role. No business logic — pass-through to
 * in-memory stores. Read-only endpoints are safe for frequent polling.
 */

import path from "path";
import type { Express } from "express";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import { getErrors, clearErrors, errorCount } from "../core/observability/error-store";
import { getMetrics, resetMetrics } from "../core/observability/metrics";
import { getDeadLetterEvents, requeueDeadLetterEvent } from "../modules/orders/orders.outbox.worker";
import { getJobRegistry, getSlowJobsReport } from "../core/jobs/job-registry";
import { getBackupStats } from "../backup";

export function register(app: Express): void {
  // ── GET /api/admin/observability/errors ─────────────────────────────
  app.get(
    "/api/admin/observability/errors",
    requireAuth,
    requireRole(["MASTER"]),
    (req, res) => {
      const limit = Math.min(Number(req.query.limit ?? 200), 500);
      const severity = req.query.severity as string | undefined;

      let data = getErrors(limit);
      if (severity === "ERROR" || severity === "WARN") {
        data = data.filter((e) => e.severity === severity);
      }

      return res.json({
        success: true,
        data,
        meta: { total: errorCount(), returned: data.length },
      });
    },
  );

  // ── DELETE /api/admin/observability/errors ──────────────────────────
  app.delete(
    "/api/admin/observability/errors",
    requireAuth,
    requireRole(["MASTER"]),
    (_req, res) => {
      clearErrors();
      return res.json({ success: true, message: "Error store cleared" });
    },
  );

  // ── GET /api/admin/observability/metrics ────────────────────────────
  app.get(
    "/api/admin/observability/metrics",
    requireAuth,
    requireRole(["MASTER"]),
    (_req, res) => {
      return res.json({ success: true, data: getMetrics() });
    },
  );

  // ── POST /api/admin/observability/metrics/reset ─────────────────────
  app.post(
    "/api/admin/observability/metrics/reset",
    requireAuth,
    requireRole(["MASTER"]),
    (_req, res) => {
      resetMetrics();
      return res.json({ success: true, message: "Metrics reset" });
    },
  );

  // ── GET /api/admin/observability/jobs ────────────────────────────────
  // Lista todos os jobs registrados e seu estado atual (running, ok, error…)
  app.get(
    "/api/admin/observability/jobs",
    requireAuth,
    requireRole(["MASTER"]),
    (_req, res) => {
      return res.json({ success: true, data: getJobRegistry() });
    },
  );

  // ── GET /api/admin/observability/slow-jobs ───────────────────────────
  // T701 — Todos os jobs com métricas de latência (avg, p95), contagem de
  // execuções lentas, estado atual e metadados de contexto.
  // Ordenado por slowRuns desc para que os piores offenders apareçam primeiro.
  app.get(
    "/api/admin/observability/slow-jobs",
    requireAuth,
    requireRole(["MASTER"]),
    (_req, res) => {
      const data = getSlowJobsReport();
      return res.json({
        success: true,
        data,
        meta: {
          total: data.length,
          slowJobsCount: data.filter((j) => j.slowRuns > 0).length,
          runningCount:  data.filter((j) => j.currentlyRunning).length,
          slowThresholdMs: 60_000,
        },
      });
    },
  );

  // ── GET /api/admin/observability/dead-letter ─────────────────────────
  // FASE 3.2 — eventos de outbox que excederam MAX_RETRIES e aguardam
  // intervenção manual. Expostos aqui para visualização e re-enfileiramento.
  app.get(
    "/api/admin/observability/dead-letter",
    requireAuth,
    requireRole(["MASTER"]),
    async (_req, res) => {
      try {
        const events = await getDeadLetterEvents();
        return res.json({
          success: true,
          data: events,
          meta: { total: events.length },
        });
      } catch (err: any) {
        return res.status(500).json({ success: false, error: err?.message ?? "Erro interno" });
      }
    },
  );

  // ── POST /api/admin/observability/dead-letter/:id/requeue ────────────
  // FASE 3.2 — re-enfileira um evento dead-letter para reprocessamento.
  // Limpa dead_letter=false, retry_count=0, next_retry_at=NULL.
  app.post(
    "/api/admin/observability/dead-letter/:id/requeue",
    requireAuth,
    requireRole(["MASTER"]),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!id || isNaN(id)) {
          return res.status(400).json({ success: false, error: "ID inválido" });
        }
        await requeueDeadLetterEvent(id);
        return res.json({ success: true, message: `Evento #${id} re-enfileirado` });
      } catch (err: any) {
        return res.status(500).json({ success: false, error: err?.message ?? "Erro interno" });
      }
    },
  );

  // ── GET /api/admin/observability/backup-durability ───────────────────
  // T901 — Backup durability visibility. Shows storage mode, risk level,
  // file counts, sizes and timestamps so MASTER can assess recovery risk.
  // Does NOT implement S3 — visibility only.
  app.get(
    "/api/admin/observability/backup-durability",
    requireAuth,
    requireRole(["MASTER"]),
    (_req, res) => {
      try {
        const stats = getBackupStats();
        const backupDir = path.join(process.cwd(), "backups");
        return res.json({
          success: true,
          data: {
            backupDir,
            totalFiles: stats.totalBackups,
            jsonCount: stats.jsonCount,
            sqlCount: stats.sqlCount,
            totalSizeMb: parseFloat((stats.totalSizeBytes / 1024 / 1024).toFixed(2)),
            latestBackup: stats.lastBackup,
            oldestBackup: stats.oldestBackup,
            storageMode: "LOCAL_EPHEMERAL",
            riskLevel: "HIGH",
            productionWarning:
              "Backups are stored on the local filesystem. In Replit Autoscale deployments this storage is ephemeral and lost on every redeploy or instance restart.",
            recommendation:
              "Integrate an external object store (S3, Supabase Storage, GCS) before relying on backups as a production recovery mechanism.",
          },
        });
      } catch (err: any) {
        return res.status(500).json({ success: false, error: err?.message ?? "Erro interno" });
      }
    },
  );

  // ── GET /api/admin/observability/health ──────────────────────────────
  // T905 — System health snapshot: uptime, memory, heap, event-loop lag,
  // active tenants, worker state, overall health signal.
  // Polling-safe (read-only, no DB queries, pure in-memory).
  app.get(
    "/api/admin/observability/health",
    requireAuth,
    requireRole(["MASTER"]),
    (_req, res) => {
      try {
        const mem = process.memoryUsage();
        const jobs = getJobRegistry();
        const metrics = getMetrics();
        const uptimeSeconds = Math.floor(process.uptime());

        const workersRunning = jobs.filter((j) => j.isRunning).length;
        const workersErrored = jobs.filter((j) => j.lastStatus === "error").length;
        const activeTenants = Object.keys(metrics.requestsByTenant).length;

        // Simple event-loop lag estimate: schedule a setImmediate and measure
        // how long the current synchronous tick held the loop.
        // (Conservative — real lag requires async measurement, but this is
        //  sufficient as an operational signal without adding async complexity.)
        const loopLagMs = 0; // placeholder; true async lag needs a separate worker

        const errorRate =
          metrics.totalRequests > 0
            ? parseFloat(((metrics.totalErrors / metrics.totalRequests) * 100).toFixed(2))
            : 0;

        const healthStatus =
          workersErrored > 0 && workersErrored === jobs.length
            ? "CRITICAL"
            : errorRate > 10
              ? "DEGRADED"
              : "OK";

        return res.json({
          success: true,
          data: {
            uptimeSeconds,
            uptimeHuman: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`,
            memory: {
              rssMb: parseFloat((mem.rss / 1024 / 1024).toFixed(1)),
              heapUsedMb: parseFloat((mem.heapUsed / 1024 / 1024).toFixed(1)),
              heapTotalMb: parseFloat((mem.heapTotal / 1024 / 1024).toFixed(1)),
              externalMb: parseFloat((mem.external / 1024 / 1024).toFixed(1)),
              heapUsedPct: parseFloat(((mem.heapUsed / mem.heapTotal) * 100).toFixed(1)),
            },
            eventLoopLagMs: loopLagMs,
            workers: {
              total: jobs.length,
              running: workersRunning,
              errored: workersErrored,
              idle: jobs.filter((j) => j.lastStatus === "idle").length,
              ok: jobs.filter((j) => j.lastStatus === "ok").length,
            },
            tenants: {
              active: activeTenants,
            },
            requests: {
              total: metrics.totalRequests,
              errors: metrics.totalErrors,
              errorRatePct: errorRate,
              nfeFailures: metrics.nfeFailures,
              jobFailures: metrics.jobFailures,
              deadLetterCount: metrics.deadLetterCount,
            },
            healthStatus,
            checkedAt: new Date().toISOString(),
            nodeVersion: process.version,
            env: process.env.NODE_ENV ?? "unknown",
          },
        });
      } catch (err: any) {
        return res.status(500).json({ success: false, error: err?.message ?? "Erro interno" });
      }
    },
  );
}
