import type { Express } from "express";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { systemState } from "../core/state/system-state";
import { db } from "../database/db";
import { systemAlerts } from "../../shared/schema";
import { desc } from "drizzle-orm";

export function registerSystemStateRoutes(app: Express) {
  app.get(
    "/api/admin/system-state",
    requireAuthCore,
    requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]),
    async (_req, res) => {
      try {
        const state = systemState.get();
        const recentAlerts = await db
          .select()
          .from(systemAlerts)
          .orderBy(desc(systemAlerts.createdAt))
          .limit(20);

        res.json({
          success: true,
          data: {
            risk:           state.risk,
            anomalies:      state.anomalies,
            alerts:         recentAlerts,
            policies:       state.policies,
            protectiveMode: state.protectiveMode,
            health:         state.health,
            recommendation: state.recommendation,
            updatedAt:      state.updatedAt,
          },
        });
      } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message ?? "Failed to load system state" });
      }
    }
  );
}
