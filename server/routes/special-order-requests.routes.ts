import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { sendSpecialOrderResolved } from "../services/mailer";
import { validateCompanyTenant } from "../core/security/orderSecurity";

export function register(app: Express) {
  // Client: submit special order
  app.post('/api/special-order-requests', async (req, res) => {
    try {
      const { companyId, requestedDay, requestedDate, description, quantity, observations, items } = req.body;
      if (!companyId) return res.status(400).json({ message: "ID da empresa é obrigatório." });
      if (!requestedDay) return res.status(400).json({ message: "Dia desejado é obrigatório." });
      if (Array.isArray(items) && items.length > 0) {
        for (const it of items) {
          if (!it.productName?.trim()) return res.status(400).json({ message: "Nome do produto é obrigatório." });
          if (!it.quantity?.trim()) return res.status(400).json({ message: "Quantidade do produto é obrigatória." });
          if (!it.category) return res.status(400).json({ message: "Categoria do produto é obrigatória." });
        }
      }
      const descFinal = description || (Array.isArray(items) && items.length ? items.map((i: any) => i.productName).join(', ') : 'Pedido pontual');
      const qtyFinal = quantity || (Array.isArray(items) && items.length ? items.map((i: any) => i.quantity).join(', ') : '1');
      const req2 = await storage.createSpecialOrderRequest({
        companyId: Number(companyId), requestedDay,
        requestedDate: requestedDate || null,
        description: descFinal, quantity: qtyFinal,
        observations: observations || null,
        items: Array.isArray(items) && items.length ? items : null,
        estimatedDeliveryDate: null,
      });
      res.status(201).json(req2);
    } catch (e: any) {
      console.error('[POST /api/special-order-requests]', e);
      res.status(500).json({ message: e?.message || "Erro interno ao salvar pedido pontual." });
    }
  });

  // Client: list own requests
  app.get('/api/special-order-requests/company/:companyId', async (req, res) => {
    try {
      // FASE 6 — BATCH FINAL: auth + tenant guard.
      if (!(req as any).session?.userId && !(req as any).session?.companyId) {
        return res.status(401).json({ message: 'Não autenticado' });
      }
      const companyId = Number(req.params.companyId);
      try {
        validateCompanyTenant(companyId, req);
      } catch {
        return res.status(403).json({ message: 'Acesso negado' });
      }
      const items = await storage.getSpecialOrderRequestsByCompany(companyId);
      res.json(items);
    } catch { res.status(500).json({ message: "Erro interno" }); }
  });

  // Admin: list all
  app.get('/api/special-order-requests', async (req, res) => {
    try {
      const items = await storage.getSpecialOrderRequests();
      res.json(items);
    } catch { res.status(500).json({ message: "Erro interno" }); }
  });

  // Admin: approve/reject (ADMIN, DIRECTOR, DEVELOPER only)
  app.put('/api/special-order-requests/:id', async (req, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      const actingUser = await storage.getUser(req.session.userId);
      if (!actingUser || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(actingUser.role)) {
        return res.status(403).json({ message: 'Apenas Administrador, Diretor ou Desenvolvedor podem aprovar/recusar pedidos pontuais.' });
      }
      const id = Number(req.params.id);
      const { status, adminNote, items, estimatedDeliveryDate } = req.body;
      if (!status || !['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ message: 'Status inválido.' });
      if (status === 'REJECTED' && !adminNote?.trim()) return res.status(400).json({ message: 'Informe o motivo da recusa.' });
      const allSpecial = await storage.getSpecialOrderRequests();
      const sr = allSpecial.find(r => r.id === id);
      const updated = await storage.updateSpecialOrderRequest(id, {
        status, adminNote, resolvedAt: new Date(),
        ...(items !== undefined ? { items } : {}),
        ...(estimatedDeliveryDate !== undefined ? { estimatedDeliveryDate } : {}),
      } as any);
      res.json(updated);

      // Send email (non-blocking)
      if (sr && (status === 'APPROVED' || status === 'REJECTED')) {
        try {
          const company = await storage.getCompany(sr.companyId);
          if (company) {
            await sendSpecialOrderResolved({
              toEmail: company.email,
              companyName: company.companyName,
              requestedDay: sr.requestedDay || "—",
              status,
              adminNote,
            });
          }
        } catch (emailErr) {
          console.error("[EMAIL] Erro ao enviar email de pedido pontual:", emailErr);
        }
      }
    } catch { res.status(500).json({ message: "Erro interno" }); }
  });
}
