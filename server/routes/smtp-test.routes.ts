import type { Express } from "express";
import { mailerStatus, sendTestEmail } from "../services/mailer";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";

const SMTP_ROLES = ['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'];

export function register(app: Express) {
  app.post('/api/admin/smtp-test', requireAuthCore, requireRole(SMTP_ROLES), async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId);
      const status = mailerStatus();
      if (!status.configured) return res.status(400).json({ message: 'SMTP não configurado. Configure SMTP_HOST, SMTP_USER e SMTP_PASS primeiro.' });
      const toEmail = req.body.toEmail || process.env.SMTP_USER || '';
      if (!toEmail) return res.status(400).json({ message: 'E-mail de destino não informado.' });
      const result = await sendTestEmail(toEmail);
      if (result.sent) {
        await storage.createLog({ action: 'SMTP_TEST', description: `E-mail de teste enviado para ${toEmail}`, userId: user?.id, userEmail: user?.email, userRole: user?.role, level: 'INFO' });
        res.json({ ok: true, message: `E-mail de teste enviado para ${toEmail}` });
      } else {
        res.status(500).json({ ok: false, message: `Falha no envio: ${result.reason}` });
      }
    } catch (e: any) { res.status(500).json({ message: e?.message }); }
  });

  app.get('/api/admin/mailer-status', requireAuthCore, requireRole(SMTP_ROLES), (req, res) => {
    res.json(mailerStatus());
  });
}
