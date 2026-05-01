/**
 * FASE 7.1 — Security Events endpoint.
 *
 * Read-only. Exposes the in-memory circular event buffer from
 * securityLogger.ts. Zero DB dependency — pure in-memory snapshot.
 * Protected: MASTER and ADMIN roles only.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../services/storage.ts";
import {
  getSecurityEvents,
  getTopIPs,
  getEventSummary,
} from "../core/security/securityLogger";

export function register(app: Express): void {
  app.get(
    "/api/admin/security/events",
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
