import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { sendTestEmail, reloadSmtpConfig } from "../services/mailer";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";

export function register(app: Express) {
  app.get('/api/smtp-config', requireAuthCore, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const cfg = await storage.getSmtpConfig();
      if (!cfg) return res.json({ host: '', port: 587, user: '', password: '', senderEmail: '', senderName: 'VivaFrutaz', hasPassword: false });
      res.json({ ...cfg, password: cfg.password ? '••••••••' : '', hasPassword: !!cfg.password });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put('/api/smtp-config', requireAuthCore, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const { host, port, user: smtpUser, password, senderEmail, senderName } = req.body;
      const existing = await storage.getSmtpConfig();
      const newPassword = (password && password !== '••••••••') ? password : (existing?.password || '');
      const result = await storage.upsertSmtpConfig({
        host: host || '',
        port: Number(port) || 587,
        user: smtpUser || '',
        password: newPassword,
        senderEmail: senderEmail || '',
        senderName: senderName || 'VivaFrutaz',
      });
      await reloadSmtpConfig();
      res.json({ ...result, password: result.password ? '••••••••' : '', hasPassword: !!result.password });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post('/api/smtp-config/test', requireAuthCore, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const cfg = await storage.getSmtpConfig();
      if (!cfg || !cfg.host || !cfg.user || !cfg.password) {
        return res.status(400).json({ message: 'Configure e salve o SMTP antes de testar.' });
      }
      const toEmail = user.email || cfg.senderEmail;
      if (!toEmail) return res.status(400).json({ message: 'Nenhum e-mail de destino disponível.' });
      const result = await sendTestEmail(toEmail, user.name || 'Admin');
      if (result.sent) {
        res.json({ success: true, message: `E-mail de teste enviado para ${toEmail}. Configuração SMTP funcionando corretamente.` });
      } else {
        res.status(500).json({ success: false, message: result.reason || 'Falha ao enviar e-mail de teste.' });
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
