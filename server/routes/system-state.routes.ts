import type { Express } from "express";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { systemState } from "../core/state/system-state";
import { db } from "../database/db";
import { systemAlerts, systemPolicies } from "../../shared/schema";
import { desc, or, isNull, eq } from "drizzle-orm";
import { storage } from "../services/storage";

/**
 * FASE B — Multi-tenant system-state route (backward-compatible).
 *
 * Tenant scoping rules:
 *  - MASTER: may pass ?tenantId=<id> to scope to a specific tenant,
 *    or omit it to get the global (legacy) view (NULL rows only).
 *  - All other roles: always scoped to their own empresaId.
 *
 * Legacy rows (tenant_id IS NULL) are always included in every query
 * so existing data is never lost.
 */
export function registerSystemStateRoutes(app: Express) {
  app.get(
    "/api/admin/system-state",
    requireAuthCore,
    requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]),
    async (req, res) => {
      try {
        const session = (req as any).session;
        const userId: number | undefined = session?.userId;
        const userRole: string = session?.userRole ?? "UNKNOWN";

        /* ── Resolve effective tenantId ── */
        let effectiveTenantId: string | null = null;

        if (userRole === "MASTER") {
          // MASTER can scope to any tenant via query param, or stay global
          const qp = (req.query as any).tenantId;
          effectiveTenantId = typeof qp === "string" && qp.trim() ? qp.trim() : null;
        } else {
          // Non-MASTER users are locked to their own empresaId
          if (userId) {
            try {
              const user = await storage.getUser(userId);
              if (user?.empresaId != null) {
                effectiveTenantId = String(user.empresaId);
              }
            } catch {
              /* fall through — stay global for safety */
            }
          }
        }

        const state = systemState.get();

        /* ── Alerts — filter by tenantId or show global (NULL) rows ── */
        const alertsQuery = db
          .select()
          .from(systemAlerts)
          .orderBy(desc(systemAlerts.createdAt))
          .limit(20);

        const recentAlerts = effectiveTenantId
          ? await db
              .select()
              .from(systemAlerts)
              .where(
                or(
                  eq(systemAlerts.tenantId, effectiveTenantId),
                  isNull(systemAlerts.tenantId)
                )
              )
              .orderBy(desc(systemAlerts.createdAt))
              .limit(20)
          : await alertsQuery;

        /* ── Policies — query DB directly so we can filter by tenantId ── */
        const dbPolicies = effectiveTenantId
          ? await db
              .select()
              .from(systemPolicies)
              .where(
                or(
                  eq(systemPolicies.tenantId, effectiveTenantId),
                  isNull(systemPolicies.tenantId)
                )
              )
              .orderBy(desc(systemPolicies.priority))
          : await db
              .select()
              .from(systemPolicies)
              .where(isNull(systemPolicies.tenantId))
              .orderBy(desc(systemPolicies.priority));

        // Merge with in-memory policies (in-memory policies have no tenantId — legacy/global)
        // Use DB as source of truth when scoped; fall back to singleton for global view
        const policies =
          dbPolicies.length > 0
            ? dbPolicies.map(p => ({
                id:       p.id,
                name:     p.name,
                type:     p.type,
                enabled:  p.enabled,
                priority: p.priority,
                tenantId: p.tenantId ?? null,
              }))
            : state.policies.map(p => ({ ...p, tenantId: null }));

        res.json({
          success: true,
          data: {
            risk:           state.risk,
            anomalies:      state.anomalies,
            alerts:         recentAlerts,
            policies,
            protectiveMode: state.protectiveMode,
            health:         state.health,
            recommendation: state.recommendation,
            updatedAt:      state.updatedAt,
            /* ── tenant metadata (new) ── */
            tenantScope: effectiveTenantId ?? "global",
            isMaster:    userRole === "MASTER",
          },
        });
      } catch (error: any) {
        res.status(500).json({
          success: false,
          message: error?.message ?? "Failed to load system state",
        });
      }
    }
  );
}
