import type { Express } from "express";
import { storage } from "../services/storage.ts";

export function register(app: Express) {
  // ─── About Us Routes ────────────────────────────────────────────────────────
  app.get('/api/about-us', async (req: any, res) => {
    try {
      if (!req.session?.userId && !req.session?.companyId) return res.status(401).json({ message: 'Não autenticado' });
      const data = await storage.getAboutUs();
      res.json(data || { title: 'Quem Somos Nós', content: '', foundingYear: null, mission: null, vision: null, values: null, imageBase64: null, imageType: null });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put('/api/about-us', async (req: any, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const { title, content, foundingYear, mission, vision, values, imageBase64, imageType } = req.body;
      const result = await storage.upsertAboutUs({ title, content, foundingYear, mission, vision, values, imageBase64, imageType });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
