import type { Express } from "express";
import { readFile } from "node:fs/promises";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function registerGovernanceRoutes(app: Express) {
  app.get("/api/admin/governance/summary", requireAuthCore, requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]), async (_req, res) => {
    try {
      const [cli, truth, drift, alert, gov, chaos, gate, healing, sandbox] = await Promise.all([
        readJson("scripts/output/cli-auth-audit.json"),
        readJson("scripts/output/auth-truth-layer.json"),
        readJson("scripts/output/auth-drift-dashboard.json"),
        readJson("scripts/output/auth-drift-alert-engine.json"),
        readJson("scripts/output/auth-governance-engine.json"),
        readJson("scripts/output/auth-chaos-test-engine.json"),
        readJson("scripts/output/production-readiness-gate.json"),
        readJson("scripts/output/auth-auto-healing-engine.json"),
        readJson("scripts/output/auth-patch-sandbox-engine.json"),
      ]);
      res.json({
        summary: gate.summary ?? {},
        security: cli,
        drift,
        chaos,
        governance: gov,
        productionGate: gate,
        autoHealing: healing,
        patchSandbox: sandbox,
        alert,
      });
    } catch (error: any) {
      res.status(500).json({ message: error?.message ?? "Failed to load governance data" });
    }
  });
}