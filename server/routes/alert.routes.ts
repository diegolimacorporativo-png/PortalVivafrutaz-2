import type { Express } from "express";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { db } from "../database/db";
import { systemAlerts } from "../../shared/schema";
import { desc } from "drizzle-orm";
import { protectiveModeService } from "../core/security/protective-mode.service";
import {
  getActiveAlerts,
  getAllAlerts,
} from "../core/alerts/operational-alerts.service";

const OPS_ROLES = ["MASTER", "ADMIN", "DIRECTOR"];

export function registerAlertRoutes(app: Express) {
  app.get("/api/admin/alerts", requireAuthCore, requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]), async (_req, res) => {
    const alerts = await db.select().from(systemAlerts).orderBy(desc(systemAlerts.createdAt)).limit(100);
    res.json({ success: true, data: alerts, protectiveMode: protectiveModeService.getState() });
  });

  // ── Alertas Operacionais — in-memory, dedup+cooldown ─────────
  // GET /api/admin/operational-alerts
  // Retorna alertas ativos (resolvedAt=null) com severidade, tempo ativo,
  // occurrences e correlationId. READ ONLY.
  app.get(
    "/api/admin/operational-alerts",
    requireAuthCore,
    requireRole(OPS_ROLES),
    (_req, res) => {
      const now = Date.now();
      const active = getActiveAlerts().map(a => ({
        key: a.key,
        severity: a.severity,
        title: a.title,
        message: a.message,
        correlationId: a.correlationId,
        firstSeenAt: new Date(a.firstSeenAt).toISOString(),
        lastEmitAt: new Date(a.lastEmitAt).toISOString(),
        activeForMs: now - a.firstSeenAt,
        activeForMin: Math.round((now - a.firstSeenAt) / 60_000),
        occurrences: a.occurrences,
        metadata: a.metadata,
      }));

      const bySeverity = { CRITICAL: 0, ERROR: 0, WARN: 0, INFO: 0 };
      for (const a of active) bySeverity[a.severity as keyof typeof bySeverity] += 1;

      res.json({
        success: true,
        data: {
          activeAlerts: active,
          summary: bySeverity,
          totalActive: active.length,
          ts: new Date().toISOString(),
        },
      });
    },
  );

  // ── Histórico de alertas (ativos + resolvidos recentes) ───────
  app.get(
    "/api/admin/operational-alerts/history",
    requireAuthCore,
    requireRole(OPS_ROLES),
    (_req, res) => {
      const now = Date.now();
      const all = getAllAlerts().map(a => ({
        key: a.key,
        severity: a.severity,
        title: a.title,
        message: a.message,
        correlationId: a.correlationId,
        firstSeenAt: new Date(a.firstSeenAt).toISOString(),
        lastEmitAt: new Date(a.lastEmitAt).toISOString(),
        resolvedAt: a.resolvedAt ? new Date(a.resolvedAt).toISOString() : null,
        activeForMs: (a.resolvedAt ?? now) - a.firstSeenAt,
        occurrences: a.occurrences,
        status: a.resolvedAt ? "resolved" : "active",
        metadata: a.metadata,
      }));
      res.json({ success: true, data: all, ts: new Date().toISOString() });
    },
  );
}