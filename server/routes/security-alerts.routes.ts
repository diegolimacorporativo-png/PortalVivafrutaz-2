/**
 * FASE 11 — Security Alerts endpoint.
 *
 * Exposes the in-memory operational alert buffer from alertEngine.ts.
 * Zero DB dependency — pure in-memory snapshot.
 * Protected: MASTER, ADMIN, DEVELOPER, DIRECTOR roles only.
 */
import type { Express, Request, Response } from "express";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import { getAlerts } from "../core/security/alertEngine";

export function register(app: Express): void {
  app.get(
    "/api/admin/security/alerts",
    requireAuth,
    requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]),
    (_req: Request, res: Response) => {
      try {
        const alerts = getAlerts();
        return res.json({
          success: true,
          data: alerts,
          total: alerts.length,
        });
      } catch (e: any) {
        return res.status(500).json({
          success: false,
          error: {
            code: "SECURITY_ALERTS_FAILED",
            message: e?.message ?? "Unknown error",
          },
        });
      }
    },
  );
}
