import type { Express } from "express";
import { storage } from "../services/storage.ts";

export function register(app: Express) {
  app.get('/api/quotations', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const user = await storage.getUser(req.session.userId);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
    try { res.json(await storage.getQuotations()); } catch (e) { res.status(500).json({ message: 'Erro' }); }
  });

  app.post('/api/quotations', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const user = await storage.getUser(req.session.userId);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
    try {
      const { companyName, contactName, contactPhone, email, cnpj, address, city, state, estimatedVolume, productInterest, logisticsNote, priceGroupId, priceGroupName, status, deliveryWindowsJson, deliveryWindowsRespondedBy, deliveryWindowsRespondedAt } = req.body;
      if (!companyName || !contactName) return res.status(400).json({ message: 'Empresa e contato obrigatórios' });
      const q = await storage.createQuotation({ companyName, contactName, contactPhone, email, cnpj, address, city, state, estimatedVolume, productInterest, logisticsNote, priceGroupId: priceGroupId || undefined, priceGroupName, ...(status ? { status } : {}), ...(deliveryWindowsJson ? { deliveryWindowsJson, deliveryWindowsRespondedBy, deliveryWindowsRespondedAt: deliveryWindowsRespondedAt ? new Date(deliveryWindowsRespondedAt) : undefined } : {}) });
      const hasWindows = !!deliveryWindowsJson;
      await storage.createLog({ action: hasWindows ? 'QUOTATION_WINDOWS_SET' : 'QUOTATION_CREATED', description: hasWindows ? `Logística definiu janelas de entrega ao criar cotação: ${companyName}` : `Cotação criada: ${companyName}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(q);
    } catch (e: any) { res.status(500).json({ message: e?.message || 'Erro' }); }
  });

  app.patch('/api/quotations/:id', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const user = await storage.getUser(req.session.userId);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
    try {
      const data = { ...req.body };
      if (data.deliveryWindowsRespondedAt && typeof data.deliveryWindowsRespondedAt === 'string') {
        data.deliveryWindowsRespondedAt = new Date(data.deliveryWindowsRespondedAt);
      }
      const q = await storage.updateQuotation(parseInt(req.params.id), data);
      const hasWindows = req.body.deliveryWindowsJson;
      const logDesc = hasWindows
        ? `Logística definiu janelas de entrega na cotação #${req.params.id} (${user.name || user.email})`
        : `Cotação #${req.params.id} atualizada`;
      await storage.createLog({ action: hasWindows ? 'QUOTATION_WINDOWS_SET' : 'QUOTATION_UPDATED', description: logDesc, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(q);
    } catch (e) { res.status(500).json({ message: 'Erro' }); }
  });

  app.delete('/api/quotations/:id', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const user = await storage.getUser(req.session.userId);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
    try { await storage.deleteQuotation(parseInt(req.params.id)); res.json({ ok: true }); } catch (e) { res.status(500).json({ message: 'Erro' }); }
  });
}
