import type { Express } from "express";
import { mailerStatus, sendTestEmail } from "../services/mailer";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";

export function register(app: Express) {
  // --- Test SMTP email ---
  app.post('/api/admin/smtp-test', async (req, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const status = mailerStatus();
      if (!status.configured) return res.status(400).json({ message: 'SMTP não configurado. Configure SMTP_HOST, SMTP_USER e SMTP_PASS primeiro.' });
      const toEmail = req.body.toEmail || process.env.SMTP_USER || '';
      if (!toEmail) return res.status(400).json({ message: 'E-mail de destino não informado.' });
      const result = await sendTestEmail(toEmail);
      if (result.sent) {
        await storage.createLog({ action: 'SMTP_TEST', description: `E-mail de teste enviado para ${toEmail}`, userId: user.id, userEmail: user.email, userRole: user.role, level: 'INFO' });
        res.json({ ok: true, message: `E-mail de teste enviado para ${toEmail}` });
      } else {
        res.status(500).json({ ok: false, message: `Falha no envio: ${result.reason}` });
      }
    } catch (e: any) { res.status(500).json({ message: e?.message }); }
  });

  // --- Mailer status ---
  // FASE 1 — exige sessão admin para evitar exposição de SMTP host/user.
  app.get('/api/admin/mailer-status', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR']), (req, res) => {
    res.json(mailerStatus());
  });
}
