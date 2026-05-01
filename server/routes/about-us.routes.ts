import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import { requireSessionOrCompany } from "../core/http/requireSessionOrCompany";

export function register(app: Express) {
  // GET — accessible by both admin users and company portal sessions
  app.get('/api/about-us', requireSessionOrCompany, async (req: any, res) => {
    try {
      const data = await storage.getAboutUs();
      res.json(data || { title: 'Quem Somos Nós', content: '', foundingYear: null, mission: null, vision: null, values: null, imageBase64: null, imageType: null });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // PUT — admin users only
  app.put('/api/about-us', requireAuthCore, async (req: any, res) => {
    try {
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
