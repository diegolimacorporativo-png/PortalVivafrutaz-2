import type { Express } from "express";
import { storage } from "../services/storage.ts";
import {
  sendOrderConfirmedEmail,
  sendOrderRejectedEmail,
  sendAdminBroadcast,
} from "../services/mailer";
import { safeGetOrder } from "../core/security/tenantGuard";
import { AppError } from "../shared/errors/AppError";

export async function register(app: Express): Promise<void> {
  app.get('/api/email/schedules', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    res.json(await storage.getEmailSchedules());
  });

  app.post('/api/email/schedules', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const user = await storage.getUser(session.userId);
    if (!user || !['MASTER', 'ADMIN', 'MANAGER'].includes(user.role)) return res.status(403).json({ message: 'Acesso negado' });
    const { type, label, dayOfWeek, timeOfDay, enabled } = req.body;
    if (!type || !label || !timeOfDay) return res.status(400).json({ message: 'type, label e timeOfDay são obrigatórios' });
    const schedule = await storage.createEmailSchedule({ type, label, dayOfWeek: dayOfWeek ?? null, timeOfDay, enabled: enabled ?? true });
    res.status(201).json(schedule);
  });

  app.put('/api/email/schedules/:id', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const user = await storage.getUser(session.userId);
    if (!user || !['MASTER', 'ADMIN', 'MANAGER'].includes(user.role)) return res.status(403).json({ message: 'Acesso negado' });
    const { type, label, dayOfWeek, timeOfDay, enabled } = req.body;
    const updated = await storage.updateEmailSchedule(Number(req.params.id), { type, label, dayOfWeek, timeOfDay, enabled });
    res.json(updated);
  });

  app.delete('/api/email/schedules/:id', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const user = await storage.getUser(session.userId);
    if (!user || !['MASTER', 'ADMIN', 'MANAGER'].includes(user.role)) return res.status(403).json({ message: 'Acesso negado' });
    await storage.deleteEmailSchedule(Number(req.params.id));
    res.status(204).send();
  });

  // ── Email Logs ───────────────────────────────────────────────
  app.get('/api/email/logs', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const { type, companyId, limit } = req.query as any;
    const logs = await storage.getEmailLogs({
      type: type || undefined,
      companyId: companyId ? Number(companyId) : undefined,
      limit: limit ? Number(limit) : 200,
    });
    res.json(logs);
  });

  // ── Manual Email Blast ────────────────────────────────────────
  app.post('/api/email/broadcast', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const user = await storage.getUser(session.userId);
    if (!user || !['MASTER', 'ADMIN', 'MANAGER', 'DIRECTOR'].includes(user.role)) return res.status(403).json({ message: 'Acesso negado' });

    const { subject, message, targetType, companyIds } = req.body;
    if (!subject || !message) return res.status(400).json({ message: 'subject e message são obrigatórios' });

    try {
      const allUsers = await storage.getUsers();
      let targets: typeof allUsers = [];

      if (targetType === 'all') {
        targets = allUsers.filter(u => u.role === 'CLIENT' && u.email && u.active);
      } else if (targetType === 'specific' && Array.isArray(companyIds) && companyIds.length > 0) {
        targets = allUsers.filter(u => u.email && (u as any).companyId && companyIds.includes((u as any).companyId));
      } else if (targetType === 'group' && Array.isArray(companyIds) && companyIds.length > 0) {
        targets = allUsers.filter(u => u.email && (u as any).companyId && companyIds.includes((u as any).companyId));
      } else {
        return res.status(400).json({ message: 'targetType inválido ou companyIds não fornecidos' });
      }

      const toEmails = [...new Set(targets.map(u => u.email).filter(Boolean))] as string[];
      if (toEmails.length === 0) return res.status(400).json({ message: 'Nenhum destinatário encontrado' });

      const result = await sendAdminBroadcast({
        toEmails,
        subject,
        message,
        senderName: user.email,
      });

      // Log for each recipient
      for (const email of toEmails) {
        const target = targets.find(u => u.email === email);
        await storage.createEmailLog({
          type: 'admin_broadcast',
          toEmail: email,
          toName: email,
          companyId: (target as any)?.companyId || null,
          orderId: null,
          subject,
          status: result.sent ? 'sent' : 'failed',
          errorMessage: result.sent ? null : (result.reason || null),
          metadata: { targetType, sentBy: user.email },
        });
      }

      res.json({ success: result.sent, recipients: toEmails.length, ...result });
    } catch (e: any) {
      res.status(500).json({ message: 'Erro ao enviar broadcast', detail: e.message });
    }
  });

  // ── Manual single email for order events ────────────────────
  app.post('/api/email/send-order-event', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const user = await storage.getUser(session.userId);
    if (!user || !['MASTER', 'ADMIN', 'MANAGER'].includes(user.role)) return res.status(403).json({ message: 'Acesso negado' });

    const { orderId, type } = req.body;
    if (!orderId || !type) return res.status(400).json({ message: 'orderId e type são obrigatórios' });

    try {
      // FASE 6 — leitura tenant-safe: orderId vem de req.body (input externo).
      // safeGetOrder valida tenant internamente; convertemos AppError em status
      // HTTP correto (403/404/401) sem alterar o shape de sucesso.
      let orderData;
      try {
        orderData = await safeGetOrder(Number(orderId));
      } catch (e: any) {
        if (e instanceof AppError) {
          return res.status(e.status).json({ message: e.message });
        }
        throw e;
      }
      if (!orderData || !orderData.order) return res.status(404).json({ message: 'Pedido não encontrado' });
      const order = orderData.order;
      const company = await storage.getCompany(order.companyId as number);
      if (!company) return res.status(404).json({ message: 'Empresa não encontrada' });

      // Get contact email for this company (from users)
      const allUsers = await storage.getUsers();
      const companyUser = allUsers.find(u => (u as any).companyId === order.companyId && u.email);
      const toEmail = companyUser?.email;
      if (!toEmail) return res.status(400).json({ message: 'Cliente não possui e-mail cadastrado' });

      const vfCode = (order.orderCode as string | null) || `VF-${new Date().getFullYear()}-${String(order.id as number).padStart(6, '0')}`;
      const deliveryDate = order.deliveryDate ? new Date(order.deliveryDate as string | number | Date).toLocaleDateString('pt-BR') : '—';

      let result;
      if (type === 'confirmed') {
        const items = orderData.items || [];
        result = await sendOrderConfirmedEmail({
          toEmail,
          companyName: company.companyName as string,
          vfCode,
          deliveryDate,
          totalItems: items.length,
          adminNote: (order.adminNote as string | undefined) || undefined,
        });
      } else if (type === 'rejected') {
        result = await sendOrderRejectedEmail({
          toEmail,
          companyName: company.companyName as string,
          vfCode,
          reason: req.body.reason || (order.adminNote as string | undefined) || 'Sem motivo informado',
        });
      } else {
        return res.status(400).json({ message: 'type deve ser "confirmed" ou "rejected"' });
      }

      await storage.createEmailLog({
        type: `order_${type}`,
        toEmail,
        toName: company.companyName as string,
        companyId: order.companyId as number,
        orderId: order.id as number,
        subject: type === 'confirmed' ? `Pedido ${vfCode} confirmado` : `Pedido ${vfCode} cancelado`,
        status: result.sent ? 'sent' : 'failed',
        errorMessage: result.sent ? null : (result.reason || null),
        metadata: { vfCode },
      });

      res.json({ success: result.sent, ...result });
    } catch (e: any) {
      res.status(500).json({ message: 'Erro ao enviar e-mail', detail: e.message });
    }
  });
}
