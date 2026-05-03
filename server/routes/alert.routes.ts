import type { Express } from "express";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { db } from "../database/db";
import { systemAlerts } from "../../shared/schema";
import { desc } from "drizzle-orm";
import { protectiveModeService } from "../core/security/protective-mode.service";

export function registerAlertRoutes(app: Express) {
  app.get("/api/admin/alerts", requireAuthCore, requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]), async (_req, res) => {
    const alerts = await db.select().from(systemAlerts).orderBy(desc(systemAlerts.createdAt)).limit(100);
    res.json({ success: true, data: alerts, protectiveMode: protectiveModeService.getState() });
  });
}