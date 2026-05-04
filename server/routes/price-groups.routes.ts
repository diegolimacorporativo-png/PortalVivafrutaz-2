import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { api } from "@shared/routes";
import { requireAuth, requireRole } from "../core/http/requireAuth";

const WRITE_ROLES = ["ADMIN", "DIRECTOR", "MASTER"];

export function register(app: Express) {
  // Price Groups
  app.get(api.priceGroups.list.path, async (req, res) => {
    const groups = await storage.getPriceGroups();
    res.json(groups);
  });

  app.post(api.priceGroups.create.path, requireAuth, requireRole(WRITE_ROLES), async (req, res) => {
    try {
      const input = api.priceGroups.create.input.parse(req.body);
      const group = await storage.createPriceGroup(input);
      res.status(201).json(group);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.put(api.priceGroups.update.path, requireAuth, requireRole(WRITE_ROLES), async (req, res) => {
    try {
      const input = api.priceGroups.update.input.parse(req.body);
      const group = await storage.updatePriceGroup(Number(req.params.id), input);
      res.json(group);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.delete(api.priceGroups.delete.path, requireAuth, requireRole(WRITE_ROLES), async (req, res) => {
    try {
      await storage.deletePriceGroup(Number(req.params.id));
      res.status(204).end();
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
