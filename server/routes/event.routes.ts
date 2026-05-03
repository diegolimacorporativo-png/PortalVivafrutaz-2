import type { Express } from "express";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { eventRepository } from "../core/events/event.repository";

export function registerEventRoutes(app: Express) {
  app.get("/api/admin/events/recent", requireAuthCore, requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]), async (_req, res) => {
    try {
      const events = await eventRepository.getRecentEvents(100);
      res.json({ success: true, data: events });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message ?? "Failed to load events" });
    }
  });
}