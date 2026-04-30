import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { fireNotification, VAPID_PUBLIC_KEY } from "../services/pushService";

export async function register(app: Express): Promise<void> {
  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
  });

  // Subscribe device
  app.post('/api/push/subscribe', async (req: any, res) => {
    try {
      const { endpoint, keys } = req.body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ message: 'Dados de subscrição inválidos' });
      }

      // FASE 8.6R — resolver companyId para staff (session.companyId é undefined para admins)
      const userId    = req.session?.userId    || null;
      const companyId = req.session?.companyId || null;

      let resolvedCompanyId: number | null = companyId;

      if (!resolvedCompanyId && userId) {
        const user = await storage.getUser(userId);
        resolvedCompanyId = user?.empresaId ?? null;
      }

      // fail-closed: sem companyId resolvido, a subscription seria órfã — bloquear
      if (!resolvedCompanyId) {
        console.warn("[PUSH] subscribe sem companyId resolvido — bloqueado");
        return res.status(400).json({ message: "companyId não resolvido" });
      }

      const sub = await storage.upsertPushSubscription({
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: req.headers['user-agent'] || null,
        userId,
        companyId: resolvedCompanyId,
        active: true,
      });
      res.json({ success: true, id: sub.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Unsubscribe device
  app.post('/api/push/unsubscribe', async (req: any, res) => {
    try {
      const { endpoint } = req.body;
      if (!endpoint) return res.status(400).json({ message: 'Endpoint obrigatório' });
      await storage.deactivatePushSubscription(endpoint);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get notification settings (admin)
  app.get('/api/push/settings', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const settings = await storage.getNotificationSettings();
      const count = await storage.getPushSubscriptionCount();
      res.json({ settings, subscriberCount: count });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Update notification setting (admin)
  app.patch('/api/push/settings/:event', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }
      const setting = await storage.upsertNotificationSetting(req.params.event, req.body);
      res.json(setting);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Send test push notification (admin)
  app.post('/api/push/test', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }
      await fireNotification('flora_alert', {
        message: '✅ Notificações push funcionando corretamente no VivaFrutaz!',
      }, { url: '/admin' });
      res.json({ success: true, message: 'Notificação de teste enviada!' });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
