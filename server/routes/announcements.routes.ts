import type { Express } from "express";
import { storage } from "../services/storage.ts";

export async function register(app: Express): Promise<void> {
  // Admin: list all
  app.get('/api/announcements', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const user = await storage.getUser(session.userId);
    if (!user) return res.status(401).json({ message: 'Não autorizado' });
    const list = await storage.getAnnouncements();
    res.json(list);
  });

  // Client: get active announcements for their company
  app.get('/api/announcements/active', async (req, res) => {
    const session = req.session as any;
    if (session.companyId) {
      const list = await storage.getActiveAnnouncementsForCompany(Number(session.companyId));
      return res.json(list);
    }
    if (session.userId) {
      // Staff seeing client view — return all active
      const all = await storage.getAnnouncements();
      const today = new Date().toISOString().substring(0, 10);
      return res.json(all.filter(a => a.active && a.startDate <= today && a.endDate >= today));
    }
    return res.status(401).json({ message: 'Não autorizado' });
  });

  // Admin: create
  app.post('/api/announcements', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const user = await storage.getUser(session.userId);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    const { title, message, type, priority, startDate, endDate, active, targetAll, targetClientTypes, targetCompanyIds } = req.body;
    if (!title || !message || !startDate || !endDate) return res.status(400).json({ message: 'Campos obrigatórios ausentes' });
    const row = await storage.createAnnouncement({
      title, message,
      type: type || 'info',
      priority: priority || 'normal',
      startDate, endDate,
      active: active !== false,
      targetAll: targetAll !== false,
      targetClientTypes: targetClientTypes || null,
      targetCompanyIds: targetCompanyIds || null,
      createdBy: user.id,
    });
    res.status(201).json(row);
  });

  // Admin: update
  app.put('/api/announcements/:id', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const user = await storage.getUser(session.userId);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    const row = await storage.updateAnnouncement(Number(req.params.id), req.body);
    res.json(row);
  });

  // Admin: toggle active
  app.patch('/api/announcements/:id/toggle', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const user = await storage.getUser(session.userId);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    const { active } = req.body;
    const row = await storage.updateAnnouncement(Number(req.params.id), { active });
    res.json(row);
  });

  // Admin: delete
  app.delete('/api/announcements/:id', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const user = await storage.getUser(session.userId);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    await storage.deleteAnnouncement(Number(req.params.id));
    res.status(204).end();
  });
}
