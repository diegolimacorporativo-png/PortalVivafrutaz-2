import type { Express } from "express";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { systemState } from "../core/state/system-state";
import { db } from "../database/db";
import { systemAlerts, systemPolicies } from "../../shared/schema";
import { desc, or, isNull, eq } from "drizzle-orm";
import { storage } from "../services/storage";

function resolveTenant(req: any) {
  const user = req.user;
  if (user?.role === "MASTER") {
    const tenantId = typeof req.query?.tenantId === "string" && req.query.tenantId.trim() ? req.query.tenantId.trim() : null;
    return tenantId || "GLOBAL_VIEW";
  }
  return user?.tenantId || user?.empresaId?.toString() || null;
}

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
        const currentUser = userId ? await storage.getUser(userId) : undefined;

        (req as any).user = currentUser
          ? {
              id: currentUser.id,
              role: currentUser.role,
              tenantId: currentUser.empresaId != null ? String(currentUser.empresaId) : null,
            }
          : undefined;

        const resolvedTenant = resolveTenant(req);
        const effectiveTenantId = resolvedTenant === "GLOBAL_VIEW" ? null : resolvedTenant;
        const state = systemState.get();

        const recentAlerts = effectiveTenantId
          ? await db
              .select()
              .from(systemAlerts)
              .where(or(eq(systemAlerts.tenantId, effectiveTenantId), isNull(systemAlerts.tenantId)))
              .orderBy(desc(systemAlerts.createdAt))
              .limit(20)
          : await db
              .select()
              .from(systemAlerts)
              .where(isNull(systemAlerts.tenantId))
              .orderBy(desc(systemAlerts.createdAt))
              .limit(20);

        const dbPolicies = effectiveTenantId
          ? await db
              .select()
              .from(systemPolicies)
              .where(or(eq(systemPolicies.tenantId, effectiveTenantId), isNull(systemPolicies.tenantId)))
              .orderBy(desc(systemPolicies.priority))
          : await db
              .select()
              .from(systemPolicies)
              .where(isNull(systemPolicies.tenantId))
              .orderBy(desc(systemPolicies.priority));

        const policies = dbPolicies.length > 0
          ? dbPolicies.map((p) => ({
              id: p.id,
              name: p.name,
              type: p.type,
              enabled: p.enabled,
              priority: p.priority,
              tenantId: p.tenantId ?? null,
            }))
          : state.policies.map((p) => ({ ...p, tenantId: null }));

        res.json({
          success: true,
          data: {
            risk: state.risk,
            anomalies: state.anomalies,
            alerts: recentAlerts,
            policies,
            protectiveMode: state.protectiveMode,
            health: state.health,
            recommendation: state.recommendation,
            updatedAt: state.updatedAt,
            tenantScope: effectiveTenantId ?? "global",
            isMaster: userRole === "MASTER",
            legacyReadOnly: true,
          },
        });
      } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message ?? "Failed to load system state" });
      }
    }
  );
}
