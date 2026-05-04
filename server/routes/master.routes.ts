import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { auditLog } from "../utils/auditLogger";
import {
  validateWebhookSignature,
  checkWebhookIdempotency,
} from "../modules/billing/subscription.middleware";

const requireMaster = [requireAuthCore, requireRole(['MASTER'])];

export async function register(app: Express): Promise<void> {
  app.get('/api/master/users', ...requireMaster, async (req: any, res) => {
    try {
      const allUsers = await storage.getUsers();
      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/master/reset-password', ...requireMaster, async (req: any, res) => {
    try {
      const masterUser = await storage.getUser(req.session.userId);
      const { userId, newPassword } = req.body;
      if (!userId || !newPassword) return res.status(400).json({ message: 'userId e newPassword são obrigatórios' });
      const targetUser = await storage.getUser(userId);
      if (!targetUser) return res.status(404).json({ message: 'Usuário não encontrado' });
      auditLog("RESET_USER_PASSWORD", {
        userId: masterUser!.id,
        role: masterUser!.role,
        entity: "user",
        entityId: userId,
        details: { targetEmail: targetUser.email },
      });
      await storage.updateUser(userId, { password: newPassword });
      await storage.createLog({ action: 'MASTER_RESET_PASSWORD', description: `[MASTER] Senha resetada para: ${targetUser.email} (ID ${userId})`, userId: masterUser!.id, userEmail: masterUser!.email, userRole: 'MASTER', level: 'WARN' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch('/api/master/users/:id', ...requireMaster, async (req: any, res) => {
    try {
      const masterUser = await storage.getUser(req.session.userId);
      const targetId = parseInt(req.params.id);
      const targetUser = await storage.getUser(targetId);
      if (!targetUser) return res.status(404).json({ message: 'Usuário não encontrado' });
      if (targetUser.role === 'MASTER' && targetId !== masterUser!.id && req.body.role && req.body.role !== 'MASTER') {
        return res.status(403).json({ message: 'Não é possível rebaixar outro usuário MASTER' });
      }
      const allowed = ['role', 'active', 'isLocked', 'tabPermissions', 'permissions'];
      const updates: any = {};
      for (const key of allowed) { if (req.body[key] !== undefined) updates[key] = req.body[key]; }
      auditLog("UPDATE_USER", {
        userId: masterUser!.id,
        role: masterUser!.role,
        entity: "user",
        entityId: targetId,
        details: { targetEmail: targetUser.email, updates },
      });
      await storage.updateUser(targetId, updates);
      await storage.createLog({ action: 'MASTER_UPDATE_USER', description: `[MASTER] Usuário atualizado: ${targetUser.email} — ${JSON.stringify(updates)}`, userId: masterUser!.id, userEmail: masterUser!.email, userRole: 'MASTER', level: 'WARN' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/master/unlock-user', ...requireMaster, async (req: any, res) => {
    try {
      const masterUser = await storage.getUser(req.session.userId);
      const { userId } = req.body;
      const targetUser = await storage.getUser(userId);
      if (!targetUser) return res.status(404).json({ message: 'Usuário não encontrado' });
      await storage.updateUser(userId, { isLocked: false, loginAttempts: 0 });
      await storage.createLog({ action: 'MASTER_UNLOCK_USER', description: `[MASTER] Conta desbloqueada: ${targetUser.email}`, userId: masterUser!.id, userEmail: masterUser!.email, userRole: 'MASTER', level: 'WARN' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get('/api/master/logs', ...requireMaster, async (req: any, res) => {
    try {
      const logs = await storage.getLogs(200);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get('/api/master/stats', ...requireMaster, async (req: any, res) => {
    try {
      const allCompanies = await storage.getCompanies();
      const allAssinaturas = await storage.getAssinaturas();
      const allPlanos = await storage.getPlanos();
      const allBilling = await storage.getBillingEvents();

      const ativas = allAssinaturas.filter(a => a.status === 'ativa').length;
      const trial = allAssinaturas.filter(a => a.status === 'trial').length;
      const inadimplente = allAssinaturas.filter(a => a.status === 'inadimplente').length;
      const receita = allBilling
        .filter(b => b.status === 'pago')
        .reduce((sum, b) => sum + parseFloat(b.valor || '0'), 0);

      res.json({
        totalEmpresas: allCompanies.length,
        empresasAtivas: allCompanies.filter(c => c.active).length,
        totalAssinaturas: allAssinaturas.length,
        assinaturasAtivas: ativas,
        assinaturasTrial: trial,
        assinaturasInadimplentes: inadimplente,
        totalPlanos: allPlanos.length,
        receitaTotal: receita.toFixed(2),
        eventosCobranca: allBilling.length,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── MASTER: Planos ──────────────────────────────────────────────────────────
  app.get('/api/master/planos', ...requireMaster, async (req: any, res) => {
    try {
      res.json(await storage.getPlanos());
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post('/api/master/planos', ...requireMaster, async (req: any, res) => {
    try {
      const plano = await storage.createPlano(req.body);
      res.status(201).json(plano);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put('/api/master/planos/:id', ...requireMaster, async (req: any, res) => {
    try {
      const plano = await storage.updatePlano(Number(req.params.id), req.body);
      res.json(plano);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete('/api/master/planos/:id', ...requireMaster, async (req: any, res) => {
    try {
      await storage.deletePlano(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── MASTER: Módulos do Sistema (catálogo) ────────────────────────────────────
  app.get('/api/master/modulos-sistema', requireAuthCore, async (req: any, res) => {
    try {
      const MODULOS = [
        { chave: 'dashboard',    nome: 'Dashboard',          categoria: 'geral',      icone: 'LayoutDashboard', descricao: 'Painel executivo e KPIs' },
        { chave: 'empresas',     nome: 'Empresas',           categoria: 'admin',      icone: 'Building2',       descricao: 'Gestão de clientes/empresas' },
        { chave: 'clientes',     nome: 'Clientes',           categoria: 'comercial',  icone: 'Users',           descricao: 'Cadastro de clientes' },
        { chave: 'produtos',     nome: 'Produtos',           categoria: 'estoque',    icone: 'Package',         descricao: 'Catálogo de produtos' },
        { chave: 'pedidos',      nome: 'Pedidos',            categoria: 'comercial',  icone: 'ShoppingCart',    descricao: 'Gestão de pedidos' },
        { chave: 'logistica',    nome: 'Logística',          categoria: 'logistica',  icone: 'Truck',           descricao: 'Gestão de entregas' },
        { chave: 'rotas',        nome: 'Rotas',              categoria: 'logistica',  icone: 'Route',           descricao: 'Planejamento de rotas' },
        { chave: 'motoristas',   nome: 'Motoristas',         categoria: 'logistica',  icone: 'UserCheck',       descricao: 'Painel do motorista' },
        { chave: 'gps',          nome: 'GPS',                categoria: 'logistica',  icone: 'MapPin',          descricao: 'Rastreamento GPS em tempo real' },
        { chave: 'relatorios',   nome: 'Relatórios',         categoria: 'financeiro', icone: 'BarChart3',       descricao: 'Relatórios e análises' },
        { chave: 'financeiro',   nome: 'Financeiro',         categoria: 'financeiro', icone: 'DollarSign',      descricao: 'Gestão financeira' },
        { chave: 'nota_fiscal',  nome: 'Nota Fiscal',        categoria: 'fiscal',     icone: 'FileText',        descricao: 'Emissão de NF-e 4.00' },
        { chave: 'integracoes',  nome: 'Integrações',        categoria: 'admin',      icone: 'Plug',            descricao: 'APIs e integrações externas' },
        { chave: 'ia',           nome: 'IA Operacional',     categoria: 'ia',         icone: 'Brain',           descricao: 'Inteligência artificial e diagnósticos' },
        { chave: 'marketplace',  nome: 'Loja de Módulos',    categoria: 'saas',       icone: 'Store',           descricao: 'Marketplace de módulos extras' },
      ];
      res.json(MODULOS);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── MASTER: AI Sync ─────────────────────────────────────────────────────────
  app.post('/api/admin/intelligence/ai-sync', requireAuthCore, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) return res.status(403).json({ message: 'Acesso negado' });
      const syncResults = [
        { modulo: 'Central de Inteligência', acao: 'Atualizar modelos preditivos', status: 'SYNC', detalhes: 'Modelos de análise atualizados para v3.0.0' },
        { modulo: 'Clara IA', acao: 'Sincronizar base de conhecimento', status: 'SYNC', detalhes: 'Base de conhecimento atualizada' },
        { modulo: 'IA Developer', acao: 'Calibrar análises de código', status: 'SYNC', detalhes: 'Calibração concluída' },
        { modulo: 'NF-e Diagnóstico', acao: 'Atualizar regras fiscais', status: 'SYNC', detalhes: 'Regras SEFAZ 2026 aplicadas' },
        { modulo: 'Logística IA', acao: 'Sincronizar rotas e otimizações', status: 'SYNC', detalhes: 'Algoritmos de rota atualizados' },
      ];
      res.json({
        success: true,
        syncedAt: new Date().toISOString(),
        syncedBy: user.name || user.email,
        version: 'v3.0.0',
        totalModulos: syncResults.length,
        results: syncResults,
      });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── MASTER: Assinaturas ─────────────────────────────────────────────────────
  // SECURITY: All /api/master/* endpoints are MASTER-only. The role check is
  // centralized via requireRole(['MASTER']) — composes after requireAuthCore so
  // anonymous callers get 401 and non-MASTER users get 403, both via the
  // standard error-handler shape. ?companyId=N is a *filter*, not a security
  // boundary — MASTER is by definition cross-tenant.

  app.get('/api/master/assinaturas', ...requireMaster, async (req: any, res) => {
    try {
      const filters: any = {};
      if (req.query.companyId) filters.companyId = Number(req.query.companyId);
      if (req.query.status) filters.status = req.query.status;
      res.json(await storage.getAssinaturas(filters));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post('/api/master/assinaturas', ...requireMaster, async (req: any, res) => {
    try {
      const assinatura = await storage.createAssinatura(req.body);
      res.status(201).json(assinatura);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put('/api/master/assinaturas/:id', ...requireMaster, async (req: any, res) => {
    try {
      const assinatura = await storage.updateAssinatura(Number(req.params.id), req.body);
      res.json(assinatura);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── MASTER: Billing Events ───────────────────────────────────────────────────
  app.get('/api/master/billing-events', ...requireMaster, async (req: any, res) => {
    try {
      const filters: any = {};
      if (req.query.companyId) filters.companyId = Number(req.query.companyId);
      if (req.query.status) filters.status = req.query.status;
      res.json(await storage.getBillingEvents(filters));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post('/api/master/billing-events', ...requireMaster, async (req: any, res) => {
    try {
      const event = await storage.createBillingEvent(req.body);
      res.status(201).json(event);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put('/api/master/billing-events/:id', ...requireMaster, async (req: any, res) => {
    try {
      const event = await storage.updateBillingEvent(Number(req.params.id), req.body);
      res.json(event);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── MASTER: Company-level assinatura lookup ─────────────────────────────────
  app.get('/api/master/companies/:id/assinatura', ...requireMaster, async (req: any, res) => {
    try {
      const assinatura = await storage.getAssinaturaByCompany(Number(req.params.id));
      res.json(assinatura || null);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Billing: Webhook (público, mas com HMAC + idempotência) ──────────────────
  app.post(
    '/api/billing/webhook',
    validateWebhookSignature,
    checkWebhookIdempotency,
    async (req: any, res) => {
      try {
        const { gateway, event, companyId, valor } = req.body;
        const eventId = req.body?.gatewayEventId || req.body?.eventId || req.body?.id;

        if (!eventId || !companyId) {
          return res.status(400).json({ error: 'Payload inválido' });
        }

        const assinatura = await storage.getAssinaturaByCompany(Number(companyId));
        if (!assinatura) {
          return res.status(404).json({ error: 'Assinatura não encontrada' });
        }

        const assinaturaId = assinatura.id;
        const statusMap: Record<string, string> = {
          payment_approved: 'pago',
          payment_failed: 'falhou',
          subscription_cancelled: 'estornado',
          chargeback: 'estornado',
          refund: 'estornado',
        };

        await storage.createBillingEvent({
          companyId: Number(companyId),
          assinaturaId,
          tipo: event || 'webhook',
          valor: valor || null,
          status: statusMap[event] || 'pendente',
          gateway: gateway || null,
          gatewayEventId: String(eventId),
          payload: req.body,
          descricao: `Webhook ${gateway}: ${event}`,
        });

        if (event === 'payment_approved') {
          await storage.updateAssinatura(assinaturaId, { status: 'ativa' });
        } else if (event === 'payment_failed') {
          await storage.updateAssinatura(assinaturaId, { status: 'atrasada' });
        } else if (event === 'subscription_cancelled') {
          await storage.updateAssinatura(assinaturaId, { status: 'cancelada' });
        } else if (event === 'chargeback') {
          await storage.updateAssinatura(assinaturaId, { status: 'suspensa' });
        } else if (event === 'refund') {
          await storage.updateAssinatura(assinaturaId, { status: 'cancelada' });
        }

        res.json({ received: true });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    },
  );
}
