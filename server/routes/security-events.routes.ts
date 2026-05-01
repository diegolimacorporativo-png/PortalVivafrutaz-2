/**
 * FASE 7.1 — Security Events endpoint.
 *
 * Read-only. Exposes the in-memory circular event buffer from
 * securityLogger.ts. Zero DB dependency — pure in-memory snapshot.
 * Protected: MASTER and ADMIN roles only.
 */
import type { Express, Request, Response } from "express";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import {
  getSecurityEvents,
  getTopIPs,
  getEventSummary,
} from "../core/security/securityLogger";

export function register(app: Express): void {
  app.get(
    "/api/admin/security/events",
    requireAuth,
    requireRole(["MASTER", "ADMIN"]),
    (_req: Request, res: Response) => {
      try {
        const events = getSecurityEvents();
        return res.json({
          success: true,
          data: {
            events,
            total: events.length,
            topIPs: getTopIPs(10),
            summary: getEventSummary(),
          },
        });
      } catch (e: any) {
        return res.status(500).json({
          success: false,
          error: {
            code: "SECURITY_EVENTS_FAILED",
            message: e?.message ?? "Unknown error",
          },
        });
      }
    },
  );
}
