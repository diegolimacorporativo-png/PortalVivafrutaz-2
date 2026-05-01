/**
 * FASE 7.2 — Security Analysis endpoint.
 *
 * Read-only. Runs the in-memory risk analyzer and spike detector.
 * Zero DB dependency. Zero impact on existing routes or auth.
 * Protected: MASTER and ADMIN roles only.
 */
import type { Express, Request, Response } from "express";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import { analyzeSecurity, detectSpike } from "../core/security/securityAnalyzer";

export function register(app: Express): void {
  app.get(
    "/api/admin/security/analysis",
    requireAuth,
    requireRole(["MASTER", "ADMIN"]),
    (_req: Request, res: Response) => {
      try {
        const analysis = analyzeSecurity();
        const spike = detectSpike();

        return res.json({
          success: true,
          data: {
            analysis,
            spike,
            total: analysis.length,
          },
        });
      } catch (e: any) {
        return res.status(500).json({
          success: false,
          error: {
            code: "SECURITY_ANALYSIS_FAILED",
            message: e?.message ?? "Unknown error",
          },
        });
      }
    },
  );
}
