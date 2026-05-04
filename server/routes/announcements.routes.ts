import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";

const ADMIN_ROLES = ['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'];

export async function register(app: Express): Promise<void> {
  app.get('/api/announcements', requireAuthCore, async (_req, res) => {
    const list = await storage.getAnnouncements();
    res.json(list);
  });

  app.get('/api/announcements/active', async (req, res) => {
    const session = req.session as any;
    if (session.companyId) {
      const list = await storage.getActiveAnnouncementsForCompany(Number(session.companyId));
      return res.json(list);
    }
    if (session.userId) {
      const all = await storage.getAnnouncements();
      const today = new Date().toISOString().substring(0, 10);
      return res.json(all.filter(a => a.active && a.startDate <= today && a.endDate >= today));
    }
    return res.status(401).json({ message: 'Não autorizado' });
  });

  app.post('/api/announcements', requireAuthCore, requireRole(ADMIN_ROLES), async (req: any, res) => {
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).json({ message: 'Não autorizado' });
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

  app.put('/api/announcements/:id', requireAuthCore, requireRole(ADMIN_ROLES), async (req: any, res) => {
    const row = await storage.updateAnnouncement(Number(req.params.id), req.body);
    res.json(row);
  });

  app.patch('/api/announcements/:id/toggle', requireAuthCore, requireRole(ADMIN_ROLES), async (req: any, res) => {
    const { active } = req.body;
    const row = await storage.updateAnnouncement(Number(req.params.id), { active });
    res.json(row);
  });

  app.delete('/api/announcements/:id', requireAuthCore, requireRole(ADMIN_ROLES), async (req: any, res) => {
    await storage.deleteAnnouncement(Number(req.params.id));
    res.status(204).end();
  });
}
