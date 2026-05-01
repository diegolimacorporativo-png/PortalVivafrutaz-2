/**
 * FASE 7.2 — Security Analysis endpoint.
 *
 * Read-only. Runs the in-memory risk analyzer and spike detector.
 * Zero DB dependency. Zero impact on existing routes or auth.
 * Protected: MASTER and ADMIN roles only.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../services/storage.ts";
import { analyzeSecurity, detectSpike } from "../core/security/securityAnalyzer";

export function register(app: Express): void {
  app.get(
    "/api/admin/security/analysis",
    // Inline auth — same pattern as security-events.routes.ts
    async (req: Request, res: Response, next: NextFunction) => {
      const session = (req as any).session;
      if (!session?.userId) {
        return res.status(401).json({
          success: false,
          error: { message: "Não autenticado", code: "UNAUTHORIZED" },
        });
      }
      try {
        const user = await storage.getUser(session.userId);
        if (!user || !["MASTER", "ADMIN"].includes(user.role)) {
          return res.status(403).json({
            success: false,
            error: { message: "Sem permissão", code: "FORBIDDEN" },
          });
        }
      } catch {
        return res.status(500).json({
          success: false,
          error: { message: "Erro interno", code: "INTERNAL_ERROR" },
        });
      }
      next();
    },
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
