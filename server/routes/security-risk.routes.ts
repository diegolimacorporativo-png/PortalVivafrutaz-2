/**
 * FASE 14.9 — Risk Derivation Layer: read-only risk score endpoint.
 * FASE 14.X  — Unified: delegates 100% to SecurityAnalyticsEngine.
 *
 * GET /api/admin/security/risk
 *
 * Thin adapter over SecurityAnalyticsEngine. Enriches companyRisks with
 * company names from the storage facade. 100% read-only.
 *
 * Protected: MASTER and ADMIN roles only.
 */

import type { Express, Request, Response } from "express";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import { runSecurityAnalytics } from "../core/security/securityAnalytics.engine";
import { storage } from "../services/storage";

export function register(app: Express): void {
  app.get(
    "/api/admin/security/risk",
    requireAuth,
    requireRole(["MASTER", "ADMIN"]),
    async (_req: Request, res: Response) => {
      try {
        // Engine handles everything — just extract companyRisks
        const report = await runSecurityAnalytics(7);

        if (report.companyRisks.length === 0) {
          return res.json({
            success: true,
            data: { generatedAt: report.generatedAt, results: [] },
          });
        }

        // Enrich with company names — best-effort, fail-open
        const nameMap = new Map<number, string>();
        for (const { companyId } of report.companyRisks) {
          if (!companyId) continue;
          try {
            const company = await storage.getCompany(companyId);
            if (company) {
              nameMap.set(
                companyId,
                (company as any).companyName ?? (company as any).name ?? `Empresa #${companyId}`,
              );
            }
          } catch {
            /* fail-open */
          }
        }

        const results = report.companyRisks.map(r => ({
          companyId: r.companyId,
          name:      nameMap.get(r.companyId) ?? `Empresa #${r.companyId}`,
          riskScore: r.riskScore,
          breakdown: r.breakdown,
        }));

        return res.json({
          success: true,
          data: { generatedAt: report.generatedAt, results },
        });
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: { code: "RISK_DERIVATION_FAILED", message: err?.message ?? "Unknown error" },
        });
      }
    },
  );
}
