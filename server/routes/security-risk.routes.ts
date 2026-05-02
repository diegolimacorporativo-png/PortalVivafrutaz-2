/**
 * FASE 14.9 — Risk Derivation Layer: read-only risk score endpoint.
 *
 * GET /api/admin/security/risk
 *
 * Queries auth_attempts (PostgreSQL) via RiskDerivationService and joins
 * with company names from the storage facade. 100% read-only — zero writes,
 * zero side effects on auth flow, session, or rate limit.
 *
 * Protected: MASTER and ADMIN roles only.
 */

import type { Express, Request, Response } from "express";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import { computeAllCompanyRisks } from "../core/security/riskDerivation.service";
import { storage } from "../services/storage";

export function register(app: Express): void {
  app.get(
    "/api/admin/security/risk",
    requireAuth,
    requireRole(["MASTER", "ADMIN"]),
    async (_req: Request, res: Response) => {
      try {
        // Compute risk for all companies that appear in auth_attempts (last 7d)
        const risks = await computeAllCompanyRisks();

        if (risks.length === 0) {
          return res.json({
            success: true,
            data: { generatedAt: new Date().toISOString(), results: [] },
          });
        }

        // Fetch company names for display — best-effort (unknown names shown as ID)
        const companyIds = risks.map(r => r.companyId).filter(Boolean);
        const nameMap = new Map<number, string>();
        for (const cid of companyIds) {
          try {
            const company = await storage.getCompany(cid);
            if (company) {
              nameMap.set(cid, (company as any).companyName ?? (company as any).name ?? `Empresa #${cid}`);
            }
          } catch {
            // fail-open: leave nameMap entry absent
          }
        }

        const results = risks.map(r => ({
          companyId:  r.companyId,
          name:       nameMap.get(r.companyId) ?? `Empresa #${r.companyId}`,
          riskScore:  r.riskScore,
          breakdown:  r.breakdown,
        }));

        return res.json({
          success: true,
          data: { generatedAt: new Date().toISOString(), results },
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
