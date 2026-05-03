import type { Express } from "express";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { db } from "../database/db";
import { systemPolicies } from "../../shared/schema";
import { desc } from "drizzle-orm";
import { runPolicySimulation } from "../core/policy/policy-engine.service";

export function registerPolicyRoutes(app: Express) {
  app.get("/api/admin/policies", requireAuthCore, requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]), async (_req, res) => {
    const policies = await db.select().from(systemPolicies).orderBy(desc(systemPolicies.priority));
    res.json({ success: true, data: policies });
  });
  app.post("/api/admin/policies/simulate", requireAuthCore, requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]), async (req, res) => {
    const result = await runPolicySimulation(req.body);
    res.json({ success: true, data: result });
  });
}