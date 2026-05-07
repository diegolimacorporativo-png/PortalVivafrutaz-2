import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { api } from "@shared/routes";
import { requireAuth, requireRole, requireSession } from "../core/http/requireAuth";
import { auditLog } from "../utils/auditLogger";

const WRITE_ROLES = ["ADMIN", "DIRECTOR", "MASTER"];

export function register(app: Express) {
  // F1-E2: was unauthenticated — now requires any valid session
  app.get(api.priceGroups.list.path, requireSession, async (req, res) => {
    const groups = await storage.getPriceGroups();
    res.json(groups);
  });

  app.post(api.priceGroups.create.path, requireAuth, requireRole(WRITE_ROLES), async (req: any, res) => {
    try {
      const input = api.priceGroups.create.input.parse(req.body);
      auditLog("CREATE_PRICE_GROUP", {
        userId: req.session?.userId,
        role: req.session?.userRole,
        entity: "price_group",
        details: input,
      });
      const group = await storage.createPriceGroup(input);
      res.status(201).json(group);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.put(api.priceGroups.update.path, requireAuth, requireRole(WRITE_ROLES), async (req: any, res) => {
    try {
      const input = api.priceGroups.update.input.parse(req.body);
      auditLog("UPDATE_PRICE_GROUP", {
        userId: req.session?.userId,
        role: req.session?.userRole,
        entity: "price_group",
        entityId: Number(req.params.id),
        details: input,
      });
      const group = await storage.updatePriceGroup(Number(req.params.id), input);
      res.json(group);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.delete(api.priceGroups.delete.path, requireAuth, requireRole(WRITE_ROLES), async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      auditLog("DELETE_PRICE_GROUP", {
        userId: req.session?.userId,
        role: req.session?.userRole,
        entity: "price_group",
        entityId: id,
      });
      await storage.deletePriceGroup(id);
      res.status(204).end();
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
