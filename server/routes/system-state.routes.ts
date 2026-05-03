import type { Express } from "express";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { systemState } from "../core/state/system-state";
import { db } from "../database/db";
import { systemAlerts, systemPolicies } from "../../shared/schema";
import { desc, or, isNull, eq } from "drizzle-orm";
import { storage } from "../services/storage";
import { queryFirewall } from "../core/security/queryFirewall";
import { logSecurity } from "../core/security/securityLogger";
import { runWithTenant } from "../core/tenant/context";

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
          ? { id: currentUser.id, role: currentUser.role, tenantId: currentUser.empresaId != null ? String(currentUser.empresaId) : null }
          : undefined;
        const effectiveTenantId = userRole === "MASTER" ? (typeof session?.empresaId === "number" ? session.empresaId : null) : (currentUser?.empresaId ?? null);
        const state = systemState.get();
        const sqlScope = effectiveTenantId ?? "GLOBAL_READ_ONLY";

        const payload = await runWithTenant(
          {
            principal: {
              kind: "admin",
              empresaId: effectiveTenantId,
              userId: userId ?? 0,
              role: userRole,
            },
            empresaId: effectiveTenantId,
          },
          async () => {
            const recentAlerts = await queryFirewall(
              () =>
                effectiveTenantId
                  ? db
                      .select()
                      .from(systemAlerts)
                      .where(or(eq(systemAlerts.tenantId, String(effectiveTenantId)), isNull(systemAlerts.tenantId)))
                      .orderBy(desc(systemAlerts.createdAt))
                      .limit(20)
                  : db
                      .select()
                      .from(systemAlerts)
                      .where(isNull(systemAlerts.tenantId))
                      .orderBy(desc(systemAlerts.createdAt))
                      .limit(20),
              { userId, tenantId: sqlScope, resource: "system_alerts", action: "SYSTEM_STATE_ACCESS", sql: "SELECT * FROM system_alerts" },
            );

            const dbPolicies = await queryFirewall(
              () =>
                effectiveTenantId
                  ? db
                      .select()
                      .from(systemPolicies)
                      .where(or(eq(systemPolicies.tenantId, String(effectiveTenantId)), isNull(systemPolicies.tenantId)))
                      .orderBy(desc(systemPolicies.priority))
                  : db
                      .select()
                      .from(systemPolicies)
                      .where(isNull(systemPolicies.tenantId))
                      .orderBy(desc(systemPolicies.priority)),
              { userId, tenantId: sqlScope, resource: "system_policies", action: "SYSTEM_STATE_ACCESS", sql: "SELECT * FROM system_policies" },
            );

            const policies =
              dbPolicies.length > 0
                ? dbPolicies.map((p) => ({ id: p.id, name: p.name, type: p.type, enabled: p.enabled, priority: p.priority, tenantId: p.tenantId ?? null }))
                : state.policies.map((p) => ({ ...p, tenantId: null }));

            if (userRole === "MASTER" && effectiveTenantId != null) {
              logSecurity(`[SECURITY] TENANT_SWITCH | userId=${userId ?? "unknown"} | toTenant=${effectiveTenantId} | timestamp=${Date.now()}`);
            }

            return {
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
            };
          },
        );

        res.json({ success: true, data: payload });
      } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message ?? "Failed to load system state" });
      }
    }
  );
}
