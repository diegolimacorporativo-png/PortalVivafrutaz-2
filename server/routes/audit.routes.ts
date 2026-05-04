import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { requireSessionOrCompany } from "../core/http/requireSessionOrCompany";
import { logSecurityEvent } from "../core/audit/security-logger";

export function register(app: Express) {
  app.get('/api/admin/audit', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR']), async (req: any, res) => {
    try {
      // CAMADA-2: log cross-tenant system audit access.
      const auditActor = await storage.getUser(req.session?.userId).catch(() => null);
      logSecurityEvent({
        userId: auditActor?.id,
        companyId: (auditActor as any)?.empresaId ?? null,
        role: auditActor?.role,
        action: 'CROSS_TENANT_READ',
        resource: '/api/admin/audit',
        tenantScope: 'CROSS',
        intent: 'AUDIT_SYSTEM',
        allowed: true,
        metadata: { datasets: ['users', 'companies', 'orders', 'logs'] },
      });

      const issues: Array<{ severity: string; category: string; message: string }> = [];
      const summary = { totalUsers: 0, activeUsers: 0, totalCompanies: 0, activeCompanies: 0, errors: 0, loginFails: 0 };
      const details: {
        inactiveCompanies: any[];
        inactiveProducts: any[];
        loginFails: any[];
        systemErrors: any[];
      } = { inactiveCompanies: [], inactiveProducts: [], loginFails: [], systemErrors: [] };

      try {
        const users = await storage.getUsers();
        summary.totalUsers = users.length;
        summary.activeUsers = users.filter((u: any) => u.active).length;
        if (users.length === 0) issues.push({ severity: 'WARN', category: 'Banco de Dados', message: 'Nenhum usuário administrativo encontrado no banco de dados.' });
      } catch (e: any) {
        issues.push({ severity: 'ERROR', category: 'Banco de Dados', message: `Erro ao acessar tabela de usuários: ${e.message}` });
      }

      try {
        const companies = await storage.getCompanies();
        summary.totalCompanies = companies.length;
        summary.activeCompanies = companies.filter((c: any) => c.active).length;
        const inactive = companies.filter((c: any) => !c.active);
        if (inactive.length > 0) issues.push({ severity: 'INFO', category: 'Empresas', message: `${inactive.length} empresa(s) inativa(s) no sistema.` });
        const noPriceGroup = companies.filter((c: any) => !c.priceGroupId && c.active);
        if (noPriceGroup.length > 0) issues.push({ severity: 'WARN', category: 'Empresas', message: `${noPriceGroup.length} empresa(s) ativa(s) sem grupo de preço configurado.` });

        const orders = await storage.getOrders();
        const now = Date.now();
        details.inactiveCompanies = inactive.map((c: any) => {
          const compOrders = orders.filter((o: any) => o.companyId === c.id);
          const lastOrder = compOrders.sort((a: any, b: any) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())[0];
          const lastOrderDate = lastOrder ? lastOrder.orderDate : null;
          const daysSinceOrder = lastOrderDate ? Math.floor((now - new Date(lastOrderDate).getTime()) / 86400000) : null;
          return {
            id: c.id, companyName: c.companyName, cnpj: c.cnpj || null,
            city: c.addressCity || null, email: c.email || null,
            registeredAt: c.createdAt || null, responsible: c.responsible || null,
            lastOrderDate, daysSinceOrder, active: c.active,
          };
        });
      } catch (e: any) {
        issues.push({ severity: 'ERROR', category: 'Banco de Dados', message: `Erro ao acessar tabela de empresas: ${e.message}` });
      }

      try {
        const orders = await storage.getOrders();
        const twoMonthsAgo = new Date();
        twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
        const old = orders.filter((o: any) => new Date(o.orderDate) < twoMonthsAgo);
        if (old.length > 0) issues.push({ severity: 'WARN', category: 'Pedidos', message: `${old.length} pedido(s) com mais de 2 meses. Recomenda-se limpeza.` });
        const noCode = orders.filter((o: any) => !o.orderCode);
        if (noCode.length > 0) issues.push({ severity: 'ERROR', category: 'Pedidos', message: `${noCode.length} pedido(s) sem código VF gerado.` });
      } catch (e: any) {
        issues.push({ severity: 'ERROR', category: 'Banco de Dados', message: `Erro ao acessar tabela de pedidos: ${e.message}` });
      }

      try {
        const products = await storage.getProducts();
        const allOrders = await storage.getOrders();
        const inactive = products.filter((p: any) => !p.active);
        if (inactive.length > 0) issues.push({ severity: 'INFO', category: 'Produtos', message: `${inactive.length} produto(s) inativo(s) no catálogo.` });
        const noPrice = products.filter((p: any) => !p.basePrice);
        if (noPrice.length > 0) issues.push({ severity: 'WARN', category: 'Produtos', message: `${noPrice.length} produto(s) sem preço base definido.` });

        details.inactiveProducts = await Promise.all(inactive.map(async (p: any) => {
          return {
            id: p.id, name: p.name, category: p.category || null, active: p.active,
            basePrice: p.basePrice || null, createdAt: p.createdAt || null,
          };
        }));
      } catch (e: any) {
        issues.push({ severity: 'ERROR', category: 'Banco de Dados', message: `Erro ao acessar tabela de produtos: ${e.message}` });
      }

      try {
        const recentLogs = await storage.getLogs(500);
        const loginFailLogs = recentLogs.filter((l: any) => l.action === 'LOGIN_FAILED');
        summary.loginFails = loginFailLogs.length;
        if (loginFailLogs.length >= 5) issues.push({ severity: 'WARN', category: 'Segurança', message: `${loginFailLogs.length} tentativas de login falhas recentes detectadas.` });
        const errors = recentLogs.filter((l: any) => l.level === 'ERROR');
        summary.errors = errors.length;
        if (errors.length > 0) issues.push({ severity: 'ERROR', category: 'Logs', message: `${errors.length} evento(s) de erro registrado(s) recentemente.` });

        details.loginFails = loginFailLogs.slice(0, 50).map((l: any) => ({
          id: l.id, email: l.userEmail || l.description?.match(/[\w.+-]+@[\w.]+/)?.[0] || 'desconhecido',
          createdAt: l.createdAt, ip: l.ip || null, description: l.description || '',
          userAgent: null,
        }));

        details.systemErrors = errors.slice(0, 50).map((l: any) => ({
          id: l.id, action: l.action, description: l.description || '',
          level: l.level, createdAt: l.createdAt, userEmail: l.userEmail || null,
          userId: l.userId || null,
        }));
      } catch (e: any) {
        issues.push({ severity: 'ERROR', category: 'Logs', message: `Erro ao acessar logs do sistema: ${e.message}` });
      }

      if (issues.length === 0) {
        issues.push({ severity: 'INFO', category: 'Sistema', message: 'Nenhum problema encontrado. Sistema funcionando normalmente.' });
      }

      await storage.createLog({ action: 'AUDIT_RUN', description: `Auditoria executada. ${issues.length} item(ns) encontrado(s).`, level: 'INFO' });
      res.json({ issues, summary, details, scannedAt: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ message: "Erro ao executar auditoria" });
    }
  });

  // FASE 6.3 — auth centralizado via requireSessionOrCompany + requireRole.
  app.get('/api/audit', requireSessionOrCompany, requireRole(['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER']), async (req: any, res) => {
    try {
      const allUsers = await storage.getUsers();
      const allCompanies = await storage.getCompanies();
      const logs = await storage.getLogs(500);
      const recentErrors = logs.filter((l: any) => l.level === 'ERROR');
      const recentWarns = logs.filter((l: any) => l.level === 'WARN');
      const loginFails = logs.filter((l: any) => l.action === 'LOGIN_FAILED');
      const unauthorized = logs.filter((l: any) => l.action === 'UNAUTHORIZED_ACCESS');
      res.json({
        summary: {
          totalUsers: allUsers.length,
          activeUsers: allUsers.filter((u: any) => u.active).length,
          totalCompanies: allCompanies.length,
          activeCompanies: allCompanies.filter((c: any) => c.active).length,
          totalLogs: logs.length,
          errors: recentErrors.length,
          warnings: recentWarns.length,
          loginFails: loginFails.length,
          unauthorizedAccess: unauthorized.length,
        },
        issues: [
          ...(recentErrors.length > 0 ? [{ severity: 'ERROR', message: `${recentErrors.length} erros nos logs recentes` }] : []),
          ...(loginFails.length > 5 ? [{ severity: 'WARN', message: `${loginFails.length} tentativas de login falhas` }] : []),
          ...(unauthorized.length > 0 ? [{ severity: 'WARN', message: `${unauthorized.length} acessos não autorizados detectados` }] : []),
        ],
        recentErrors: recentErrors.slice(0, 10),
        recentWarnings: recentWarns.slice(0, 10),
      });
    } catch (e: any) { res.status(500).json({ message: e?.message }); }
  });
}
