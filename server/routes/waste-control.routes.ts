import type { Express } from "express";
import { storage } from "../services/storage.ts";

export function register(app: Express) {
  app.get('/api/waste-control', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const records = await storage.getWasteRecords();
    res.json(records);
  });

  app.post('/api/waste-control', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const user = await storage.getUser(session.userId);
    try {
      const rec = await storage.createWasteRecord({
        ...req.body,
        registeredBy: user?.name || 'Sistema',
        registeredById: session.userId,
      });
      res.status(201).json(rec);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.patch('/api/waste-control/:id', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    try {
      const rec = await storage.updateWasteRecord(Number(req.params.id), req.body);
      res.json(rec);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete('/api/waste-control/:id', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    await storage.deleteWasteRecord(Number(req.params.id));
    res.status(204).end();
  });
}
