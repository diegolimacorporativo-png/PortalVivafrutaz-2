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

import type { Express } from "express";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import { getErrors, clearErrors, errorCount } from "../core/observability/error-store";
import { getMetrics, resetMetrics } from "../core/observability/metrics";
import { getDeadLetterEvents, requeueDeadLetterEvent } from "../modules/orders/orders.outbox.worker";
import { getJobRegistry } from "../core/jobs/job-registry";

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
}
