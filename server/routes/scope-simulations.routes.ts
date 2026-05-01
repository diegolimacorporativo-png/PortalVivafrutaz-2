import type { Express } from "express";
import { storage } from "../services/storage.ts";

export function register(app: Express) {
  // ─── Clara Training Routes ────────────────────────────────────────────────
  app.get('/api/scope-simulations', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !(SCOPE_ROLES as any).includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const list = await storage.getScopeSimulations();
      res.json(list);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get('/api/scope-simulations/:id', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !(SCOPE_ROLES as any).includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const sim = await storage.getScopeSimulation(Number(req.params.id));
      if (!sim) return res.status(404).json({ message: 'Simulação não encontrada' });
      res.json(sim);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/scope-simulations', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !(SCOPE_ROLES as any).includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const { companyName, cnpj, city, contactName, phone, email, modelType, minWeeklyBilling, minMonthlyBilling, route, routeMinManha, routeMinTarde, items, totalWeekly, totalMonthly, totalCost, notes } = req.body;
      if (!companyName) return res.status(400).json({ message: 'Nome da empresa é obrigatório' });
      const sim = await storage.createScopeSimulation({
        companyName, cnpj, city, contactName, phone, email,
        modelType: modelType || 'a_definir',
        minWeeklyBilling: minWeeklyBilling || '350',
        minMonthlyBilling: minMonthlyBilling || '1400',
        route, routeMinManha: routeMinManha || '350', routeMinTarde: routeMinTarde || '450',
        items: items || [],
        totalWeekly: totalWeekly || '0',
        totalMonthly: totalMonthly || '0',
        totalCost: totalCost || '0',
        status: 'draft',
        createdByUserId: user.id,
        createdByName: user.name,
        notes,
      });
      await storage.createLog({ action: 'SCOPE_SIMULATION_CREATED', description: `Simulação criada: ${companyName}`, userId: user.id, userEmail: user.email, userRole: user.role, level: 'INFO' });
      res.status(201).json(sim);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch('/api/scope-simulations/:id', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !(SCOPE_ROLES as any).includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const existing = await storage.getScopeSimulation(Number(req.params.id));
      if (!existing) return res.status(404).json({ message: 'Simulação não encontrada' });
      const { companyName, cnpj, city, contactName, phone, email, modelType, minWeeklyBilling, minMonthlyBilling, route, routeMinManha, routeMinTarde, items, totalWeekly, totalMonthly, totalCost, status, notes } = req.body;
      const sim = await storage.updateScopeSimulation(Number(req.params.id), {
        companyName, cnpj, city, contactName, phone, email, modelType,
        minWeeklyBilling, minMonthlyBilling, route, routeMinManha, routeMinTarde,
        items, totalWeekly, totalMonthly, totalCost, status, notes,
      });
      res.json(sim);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete('/api/scope-simulations/:id', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !(SCOPE_ROLES as any).includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const existing = await storage.getScopeSimulation(Number(req.params.id));
      if (!existing) return res.status(404).json({ message: 'Simulação não encontrada' });
      if (existing.status === 'converted') return res.status(400).json({ message: 'Simulação convertida não pode ser excluída' });
      await storage.deleteScopeSimulation(Number(req.params.id));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Converter simulação em cliente real
  app.post('/api/scope-simulations/:id/convert', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const sim = await storage.getScopeSimulation(Number(req.params.id));
      if (!sim) return res.status(404).json({ message: 'Simulação não encontrada' });
      if (sim.status === 'converted') return res.status(400).json({ message: 'Simulação já foi convertida' });

      const { password, cnpj, email, phone, city, contactName, segment, priceGroupId, deliveryDay, adminFee } = req.body;
      if (!password) return res.status(400).json({ message: 'Senha é obrigatória para criar o acesso' });

      // Criar empresa cliente
      const company = await storage.createCompany({
        name: sim.companyName,
        cnpj: cnpj || sim.cnpj || '',
        email: email || sim.email || '',
        phone: phone || sim.phone || '',
        city: city || sim.city || '',
        contactName: contactName || sim.contactName || '',
        password,
        segment: segment || 'empresarial',
        priceGroupId: priceGroupId ? Number(priceGroupId) : null,
        deliveryDay: deliveryDay || null,
        adminFee: adminFee ? String(adminFee) : '0',
        active: true,
        vigenciaStart: null,
        vigenciaEnd: null,
        loginAttempts: 0,
        isLocked: false,
        lastLoginAttempt: null,
      } as any);

      // Criar itens de escopo (contractScopes)
      const items = (sim.items as any[]) || [];
      for (const item of items) {
        if (!item.productId || !item.dayOfWeek) continue;
        await storage.createContractScope({
          companyId: company.id,
          dayOfWeek: item.dayOfWeek,
          weekNumber: null,
          scopeCategory: item.category || null,
          productId: Number(item.productId),
          quantity: Number(item.quantity) || 1,
          unitPrice: item.unitPrice ? String(item.unitPrice) : null,
          averageCost: item.avgCost ? String(item.avgCost) : null,
          observation: null,
        });
      }

      // Marcar simulação como convertida
      await storage.updateScopeSimulation(sim.id, {
        status: 'converted',
        convertedToCompanyId: company.id,
        convertedAt: new Date(),
      });

      await storage.createLog({ action: 'SCOPE_SIMULATION_CONVERTED', description: `Simulação "${sim.companyName}" convertida → empresa ID ${company.id}`, userId: user.id, userEmail: user.email, userRole: user.role, level: 'INFO' });
      res.json({ company, simulation: await storage.getScopeSimulation(sim.id) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}
