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
}
