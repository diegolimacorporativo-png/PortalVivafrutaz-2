import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import { tenantContext, requireTenant } from "../middleware/tenant";

const WASTE_ROLES = ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER", "OPERATIONS_MANAGER"];

export function register(app: Express) {
  app.get('/api/waste-control', requireAuth, requireRole(WASTE_ROLES), tenantContext, requireTenant, async (req: any, res) => {
    try {
      const records = await storage.getWasteRecords();
      res.json(records);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/waste-control', requireAuth, requireRole(WASTE_ROLES), tenantContext, requireTenant, async (req: any, res) => {
    const user = await storage.getUser(req.userId);
    try {
      const rec = await storage.createWasteRecord({
        ...req.body,
        registeredBy: user?.name || 'Sistema',
        registeredById: req.userId,
      });
      res.status(201).json(rec);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.patch('/api/waste-control/:id', requireAuth, requireRole(WASTE_ROLES), tenantContext, requireTenant, async (req: any, res) => {
    try {
      const rec = await storage.updateWasteRecord(Number(req.params.id), req.body);
      res.json(rec);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete('/api/waste-control/:id', requireAuth, requireRole(WASTE_ROLES), tenantContext, requireTenant, async (req: any, res) => {
    try {
      await storage.deleteWasteRecord(Number(req.params.id));
      res.status(204).end();
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
}
