import type { Express } from "express";
import { storage } from "../services/storage.ts";

export function register(app: Express) {
  // ─── White Label: EmpresaConfig ───────────────────────────────────────────
  app.get('/api/empresa-config/:empresaId', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const cfg = await storage.getEmpresaConfig(Number(req.params.empresaId));
      res.json(cfg ?? null);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.put('/api/empresa-config/:empresaId', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const cfg = await storage.upsertEmpresaConfig(Number(req.params.empresaId), req.body);
      res.json(cfg);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });
}
