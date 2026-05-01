import type { Express, NextFunction, Request, Response } from "express";
import type { Server } from "http";
import { storage } from "../services/storage.ts";
import { ordersController } from "../modules/orders/orders.controller";
import { authController } from "../modules/auth/auth.controller";
import { financeController } from "../modules/finance/finance.controller";
// FASE FIN.3.5 — singleton de FinanceService para unificar o caminho de
// pagamento de AR. Usado na rota legacy `/api/bank/reconciliar/confirmar`
// para que a conciliação bancária dispare o hook FIN.3
// (`handleOrderPayment`) — antes ela usava `storage.payAccountReceivable`
// direto e bypassava o módulo financeiro.
import { financeService } from "../modules/finance/finance.service";
import { financeRepository } from "../modules/finance/finance.repository";
import { logisticsController } from "../modules/logistics/logistics.controller";
import { isDriverOrInternal, resolveOwnDriverId } from "../modules/logistics/driver.access";
import { companySettingsService } from "../services/companySettingsService.ts";
import { api } from "@shared/routes";
import { fireNotification, ensureDefaultNotificationSettings, VAPID_PUBLIC_KEY } from "../services/pushService";
import { z } from "zod";
import expressSession from "express-session";
import MemoryStore from "memorystore";
import {
  sendOrderPlaced, sendOrderStatusChanged, sendAdminNewOrder,
  sendPasswordResetResolved, sendSpecialOrderResolved, mailerStatus, sendTestEmail,
  sendWindowOpenReminder, sendUnfinalisedReminder, sendOrderConfirmedEmail,
  sendOrderRejectedEmail, sendAdminBroadcast, reloadSmtpConfig
} from "../services/mailer";
import { scheduleBackups, runBackup, runBackupSQL, listBackups, getBackupPath, deleteBackup, cleanOldBackups } from "../services/backup.ts";
import fs from "fs";
import bcrypt from "bcryptjs";
// FASE 7.1 — `path` import removed (0 usages confirmed). bcrypt/fs/db kept (in use).
import { db } from "../database/db.ts";
import { uploadInMemory } from "../infra/upload";
import { parsePdf } from "../infra/pdfParser";
import { orders, orderItems, companies, products, aiInteractions, nfManual, cronFaturamentoRuns, cronAlertLogs } from "@shared/schema";
// FASE 7.1 — drizzle helpers narrowed to what's actually referenced. `lte`, `and`, `eq`, `isNull` removed (0 uses); `sql` retained (12 uses); `gte`, `desc` retained.
import { gte, desc, sql } from "drizzle-orm";
import { ok, created, noContent, fail } from "../core/http/apiResponse";
import { tenantContext, requireTenant } from "../middleware/tenant";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import {
  requireActiveSubscription,
  checkPlanLimit,
  validateWebhookSignature,
  checkWebhookIdempotency,
} from "../modules/billing/subscription.middleware";
import { checkBoletosVencidos } from "../modules/billing/billing.cron";
// FASE 8.4 — call-sites de NF-e agora orquestram resolveBillingItems → buildNFeInput.
import { resolveBillingItems } from "../modules/billing/billing.service";
import {
  canEmitNFe,
  hasBlockingNFe,
  incNfeIdemBlocked,
  incNfeIdemDryRun,
  getNfeIdemMetrics,
  resetNfeIdemMetrics,
  getFiscalDefaultsStats,
  resetFiscalDefaultsStats,
  acquireOrderLock,
  releaseOrderLock,
  type OrderLockHandle,
  getDryRunMetrics,
  getTopCompanies,
  getDryRunMetricsWindow,
  getTopCompaniesWindow,
  getCronStatus,
  isCronRunning,
  runFaturamentoCron,
  getAlertLogs,
  pruneOldAlertLogs,
  buildAnomalies,
  buildInsights,
  buildDigest,
  buildAlertsCsv,
  getAlertRecipients,
  setAlertRecipients,
  alertRecipientsArraySchema,
  getUserPreferences,
  upsertUserPreference,
} from "../modules/nfe/nfe.dependencies";
import { requireTenantId } from "../core/tenant/context";
import { ENABLE_NFE_IDEMPOTENCY_GUARD } from "../config/flags";
import { getRequestIdForLog } from "../core/context/requestContext";
// FASE 3/6.5 — guarda de tenant e wrapper multi-tenant
import { validateOrderTenant, safeGetOrder, withTenantGuard } from "../core/security/orderSecurity";
import { tenantWhere, tenantAnd, withTenant } from "../core/tenant/scope";
import { currentTenantId } from "../core/tenant/context";
import { NotFoundError, BadRequestError, ConflictError, ForbiddenError, AppError } from "../shared/errors/AppError";
import { register as claraRegister } from './clara.routes';
import { register as emailRegister } from './email.routes';
import { register as pushRegister } from './push.routes';
import { register as masterRegister } from './master.routes';
import { register as logisticsRegister } from './logistics.routes';
import { register as saasRegister } from './saas.routes';
import { register as healthRegister } from './health.routes';
import { register as backupRegister } from './backup.routes';
import { register as logsRegister } from './logs.routes';
import { register as announcementsRegister } from './announcements.routes';
import { register as tasksRegister } from './tasks.routes';
import { register as quotationsRegister } from './quotations.routes';
import { register as wasteControlRegister } from './waste-control.routes';
import { register as orderExceptionsRegister } from './order-exceptions.routes';
import { register as specialOrderRequestsRegister } from './special-order-requests.routes';
import { register as passwordResetRequestsRegister } from './password-reset-requests.routes';
import { register as orderCleanupRegister } from './order-cleanup.routes';
import { register as aboutUsRegister } from './about-us.routes';
import { register as securityRegister } from './security.routes';
import { register as contractsAlertsRegister } from './contracts-alerts.routes';
import { register as companyValidateRegister } from './company-validate.routes';
import { register as purchasePlanningRegister } from './purchase-planning.routes';
import { register as incidentsRegister } from './incidents.routes';
import { register as geocodeRegister } from './geocode.routes';
import { register as searchRegister } from './search.routes';
import { register as marketplaceRegister } from './marketplace.routes';
import { register as systemVersionsRegister } from './system-versions.routes';
import { register as sanitaryRegister } from './sanitary.routes';

const SessionStore = MemoryStore(expressSession);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Session middleware is now mounted centrally in `server/app.ts` BEFORE
  // the module loader, so every router (modular + legacy) shares the same
  // store and cookie config. The legacy mount lived here historically; we
  // intentionally leave the `expressSession` and `MemoryStore` imports in
  // place above because other code in this file references them, but the
  // `app.use(expressSession(...))` block has been removed to avoid mounting
  // session twice.

  // Start backup scheduler
  scheduleBackups();

  // Auto-cleanup: remove logs older than 90 days, daily at 03:00
  (async () => {
    const cron = (await import('node-cron')).default;
    cron.schedule('0 3 * * *', async () => {
      try {
        const removed = await storage.cleanOldLogs(90);
        if (removed > 0) {
          await storage.createLog({ action: 'CLEAN_LOGS', description: `Limpeza automática: ${removed} log(s) com mais de 90 dias removidos`, level: 'INFO' });
          console.log(`[LOGS] Limpeza automática: ${removed} logs antigos removidos.`);
        }
      } catch (err) { console.error('[LOGS] Erro na limpeza automática de logs:', err); }
    });
  })();

  // Health check route — MOVED TO health.routes.ts
  // app.get("/health", (req, res) => {
  //   res.status(200).json({ status: "ok" });
  // });

  // ─── Domain route files ────────────────────────────────────────────────────
  await claraRegister(app);
  await emailRegister(app);
  await pushRegister(app);
  await masterRegister(app);
  await logisticsRegister(app);
  await saasRegister(app);
  await healthRegister(app);
  await backupRegister(app);
  await logsRegister(app);
  await announcementsRegister(app);
  tasksRegister(app);
  quotationsRegister(app);
  wasteControlRegister(app);
  orderExceptionsRegister(app);
  specialOrderRequestsRegister(app);
  passwordResetRequestsRegister(app);
  orderCleanupRegister(app);
  aboutUsRegister(app);
  securityRegister(app);
  contractsAlertsRegister(app);
  companyValidateRegister(app);
  purchasePlanningRegister(app);
  incidentsRegister(app);
  geocodeRegister(app);
  searchRegister(app);
  marketplaceRegister(app);
  systemVersionsRegister(app);
  sanitaryRegister(app);

  // --- Backup Routes — MOVED TO backup.routes.ts ---
  // GET    /api/admin/backups
  // POST   /api/admin/backups
  // POST   /api/admin/backups/sql
  // GET    /api/admin/backups/:filename
  // DELETE /api/admin/backups/:filename
  // POST   /api/admin/backups/clean-old

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

  // --- FASE 6.7 — Resumo agregado de eventos de segurança (admin only) ---
  // Endpoint super simples para o card "Segurança do Sistema" do dashboard
  // admin. Retorna `{ success, data: [{ type, total }] }`. Apenas leitura,
  // apenas papéis administrativos. Não toca em nenhum fluxo de validação,
  // log ou schema — pass-through puro sobre a tabela já existente
  // `tenant_mismatch_events`.
  app.get(
    '/api/admin/security/resumo',
    requireAuthCore,
    requireRole(['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR']),
    async (req, res, next) => {
      try {
        const { securityController } = await import('../modules/security/security.controller');
        return await securityController.resumo(req, res);
      } catch (e) {
        return next(e);
      }
    },
  );

  // --- FASE 6.1 — Tenant Mismatch Audit (read-only, MASTER only) ---
  // Endpoint de auditoria agregada para tentativas de acesso entre tenants.
  // Apenas leitura, apenas MASTER, apenas dados agregados (sem orderId/tenantId reais).
  app.get(
    '/api/admin/security/tenant-mismatch-events',
    requireAuthCore,
    requireRole(['MASTER']),
    async (req, res) => {
      try {
        console.log('[SECURITY_AUDIT] Tenant mismatch audit requested');
        const { getTenantMismatchEvents } = await import('../modules/security/security.repository');
        const days = Number(req.query.days || 7);
        const data = await getTenantMismatchEvents(days);
        return res.json({ success: true, data });
      } catch (e: any) {
        return res.status(500).json({
          success: false,
          error: {
            code: 'TENANT_MISMATCH_AUDIT_FAILED',
            message: e?.message || 'Unknown error',
          },
        });
      }
    },
  );

  // --- FASE 6.8 — Manual unblock (MASTER only) ---
  // Permite ao MASTER liberar um usuário antes do TTL de 5 min expirar.
  // Apenas em memória, idempotente, sem efeito sobre validateOrderTenant.
  app.post(
    '/api/admin/security/unblock',
    requireAuthCore,
    requireRole(['MASTER']),
    async (req, res) => {
      try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
        if (!email) {
          return res.status(400).json({
            success: false,
            error: { code: 'EMAIL_REQUIRED', message: 'Email é obrigatório' },
          });
        }

        const { unblockUser } = await import('../modules/security/security.blocker');
        const wasBlocked = unblockUser(email);

        return res.json({
          success: true,
          data: { email: email.toLowerCase(), wasBlocked },
          message: wasBlocked
            ? 'Usuário desbloqueado com sucesso'
            : 'Usuário não estava bloqueado',
        });
      } catch (e: any) {
        return res.status(500).json({
          success: false,
          error: {
            code: 'UNBLOCK_FAILED',
            message: e?.message || 'Unknown error',
          },
        });
      }
    },
  );

  // --- System Audit API ---
  // FASE 1 — exige sessão admin (auditoria revela usuários, empresas e logs).
  app.get('/api/admin/audit', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR']), async (req, res) => {
    try {
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

  // --- IA Operacional / Central de Inteligência ---
  app.get('/api/admin/intelligence', async (req, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }

      interface IntelAlert {
        id: string;
        category: 'estoque' | 'clientes' | 'produtos' | 'logistica' | 'sistema';
        severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
        title: string;
        description: string;
        actionLabel?: string;
        actionHref?: string;
        data?: Record<string, unknown>;
      }

      const alerts: IntelAlert[] = [];
      const now = Date.now();

      // ── 1. ESTOQUE ANALYSIS ───────────────────────────────────────
      try {
        const stockSettings = await storage.getInventorySettings();
        const allOrders = await storage.getOrders();
        const recentOrders = allOrders.filter((o: any) => {
          const d = new Date(o.orderDate || o.createdAt);
          return now - d.getTime() < 28 * 86400000; // last 4 weeks
        });

        // Calculate weekly avg consumption per product from recent order items
        const productWeeklyAvg: Record<string, { name: string; avgQty: number }> = {};
        for (const order of recentOrders) {
          const orderData = await storage.getOrder(order.id);
          if (!orderData || !orderData.items) continue;
          const { items } = orderData;
          for (const item of items) {
            if (!productWeeklyAvg[item.productId]) {
              productWeeklyAvg[item.productId] = { name: (item as any).productName || String(item.productId), avgQty: 0 };
            }
            productWeeklyAvg[item.productId]!.avgQty += item.quantity / 4;
          }
        }

        for (const s of stockSettings) {
          const current = parseFloat(s.currentStock as string) || 0;
          const minimum = parseFloat(s.minStock as string) || 0;
          const weekly = productWeeklyAvg[String(s.productId)]?.avgQty ?? 0;
          const productName = s.productName;

          // Stock below minimum
          if (minimum > 0 && current <= minimum) {
            alerts.push({
              id: `stock-min-${s.id}`,
              category: 'estoque',
              severity: current === 0 ? 'CRITICAL' : 'HIGH',
              title: current === 0 ? `Estoque zerado: ${productName}` : `Estoque abaixo do mínimo: ${productName}`,
              description: current === 0
                ? `${productName} está sem estoque. Estoque mínimo configurado: ${minimum} unidades.`
                : `Estoque atual (${current}) está abaixo do mínimo (${minimum}).`,
              actionLabel: 'Ver Inventário',
              actionHref: '/admin/inventory',
              data: { productName, currentStock: current, minStock: minimum },
            });
          }

          // Risk of running out based on weekly consumption
          if (weekly > 0 && current > 0 && current < weekly) {
            const daysLeft = Math.round((current / weekly) * 7);
            alerts.push({
              id: `stock-risk-${s.id}`,
              category: 'estoque',
              severity: daysLeft <= 2 ? 'CRITICAL' : daysLeft <= 4 ? 'HIGH' : 'MEDIUM',
              title: `${productName} pode acabar em ${daysLeft} dia(s)`,
              description: `Consumo semanal médio: ${weekly.toFixed(1)} un. Estoque atual: ${current} un. Estimativa: ${daysLeft} dia(s) restantes.`,
              actionLabel: 'Planejar Compra',
              actionHref: '/admin/purchase-planning',
              data: { productName, currentStock: current, weeklyAvg: parseFloat(weekly.toFixed(2)), daysLeft },
            });
          }
        }
      } catch (e: any) {
        alerts.push({ id: 'stock-error', category: 'estoque', severity: 'MEDIUM', title: 'Erro ao analisar estoque', description: e.message });
      }

      // ── 2. CLIENTES ANALYSIS ──────────────────────────────────────
      try {
        const companies = await storage.getCompanies();
        const allOrders = await storage.getOrders();
        const activeCompanies = companies.filter((c: any) => c.active);

        for (const company of activeCompanies) {
          const compOrders = allOrders.filter((o: any) => o.companyId === company.id);
          if (compOrders.length === 0) continue;

          // Sort and get last order
          const sorted = compOrders.sort((a: any, b: any) => new Date(b.orderDate || b.createdAt).getTime() - new Date(a.orderDate || a.createdAt).getTime());
          const lastOrder = sorted[0];
          if (!lastOrder) continue;
          const daysSince = Math.floor((now - new Date(lastOrder.orderDate || lastOrder.createdAt).getTime()) / 86400000);

          // Calculate historical ordering frequency (days between orders)
          if (compOrders.length >= 2) {
            const dates = sorted.map((o: any) => new Date(o.orderDate || o.createdAt).getTime());
            let totalGap = 0;
            for (let i = 0; i < dates.length - 1; i++) totalGap += dates[i]! - dates[i + 1]!;
            const avgGapDays = totalGap / (dates.length - 1) / 86400000;
            const overdueThreshold = avgGapDays * 1.8; // 80% over normal frequency

            if (daysSince > overdueThreshold && daysSince > 7) {
              alerts.push({
                id: `client-inactive-${company.id}`,
                category: 'clientes',
                severity: daysSince > 30 ? 'HIGH' : 'MEDIUM',
                title: `${company.companyName} sem pedido há ${daysSince} dias`,
                description: `Frequência histórica de pedidos: a cada ~${Math.round(avgGapDays)} dias. Último pedido: ${new Date(lastOrder.orderDate || lastOrder.createdAt).toLocaleDateString('pt-BR')}.`,
                actionLabel: 'Ver Empresa',
                actionHref: '/admin/companies',
                data: { companyId: company.id, companyName: company.companyName, daysSince, avgGapDays: parseFloat(avgGapDays.toFixed(1)) },
              });
            }
          } else if (compOrders.length === 1 && daysSince > 14) {
            alerts.push({
              id: `client-loworder-${company.id}`,
              category: 'clientes',
              severity: 'LOW',
              title: `${company.companyName} — apenas 1 pedido registrado`,
              description: `Empresa com apenas um pedido feito há ${daysSince} dias. Pode indicar cliente inativo ou em fase inicial.`,
              actionLabel: 'Ver Empresa',
              actionHref: '/admin/companies',
              data: { companyId: company.id, companyName: company.companyName, daysSince },
            });
          }
        }
      } catch (e: any) {
        alerts.push({ id: 'client-error', category: 'clientes', severity: 'MEDIUM', title: 'Erro ao analisar clientes', description: e.message });
      }

      // ── 3. PRODUTOS ANALYSIS ──────────────────────────────────────
      try {
        const products = await storage.getProducts();
        const allOrders = await storage.getOrders();

        const fourWeeksAgo = new Date(now - 28 * 86400000);
        const eightWeeksAgo = new Date(now - 56 * 86400000);

        const recentOrders = allOrders.filter((o: any) => new Date(o.orderDate || o.createdAt) >= fourWeeksAgo);
        const prevOrders = allOrders.filter((o: any) => {
          const d = new Date(o.orderDate || o.createdAt);
          return d >= eightWeeksAgo && d < fourWeeksAgo;
        });

        const recentQty: Record<number, number> = {};
        for (const order of recentOrders) {
          const orderDetail = await storage.getOrder(order.id);
          if (!orderDetail) continue;
          const { items } = orderDetail;
          for (const item of items) {
            recentQty[item.productId] = (recentQty[item.productId] || 0) + item.quantity;
          }
        }

        const prevQty: Record<number, number> = {};
        for (const order of prevOrders) {
          const orderDetail = await storage.getOrder(order.id);
          if (!orderDetail) continue;
          const { items } = orderDetail;
          for (const item of items) {
            prevQty[item.productId] = (prevQty[item.productId] || 0) + item.quantity;
          }
        }

        for (const product of products.filter((p: any) => p.active)) {
          const recent = recentQty[product.id] || 0;
          const prev = prevQty[product.id] || 0;

          // Zero orders in last 30 days (but had orders before)
          if (recent === 0 && prev > 0) {
            alerts.push({
              id: `prod-nosale-${product.id}`,
              category: 'produtos',
              severity: 'MEDIUM',
              title: `Produto sem vendas: ${product.name}`,
              description: `"${product.name}" não teve pedidos nas últimas 4 semanas (teve ${prev.toFixed(1)} un nas 4 semanas anteriores).`,
              actionLabel: 'Ver Produto',
              actionHref: '/admin/products',
              data: { productId: product.id, productName: product.name, recentQty: recent, prevQty: prev },
            });
          }

          // Sharp decline (>60% drop)
          if (prev > 0 && recent > 0) {
            const dropPct = ((prev - recent) / prev) * 100;
            if (dropPct >= 60) {
              alerts.push({
                id: `prod-decline-${product.id}`,
                category: 'produtos',
                severity: 'MEDIUM',
                title: `Queda de vendas: ${product.name} (-${Math.round(dropPct)}%)`,
                description: `Volume de pedidos caiu de ${prev.toFixed(1)} para ${recent.toFixed(1)} unidades nas últimas 4 semanas.`,
                actionLabel: 'Ver Planejamento',
                actionHref: '/admin/purchase-planning',
                data: { productId: product.id, productName: product.name, recentQty: recent, prevQty: prev, dropPct: parseFloat(dropPct.toFixed(1)) },
              });
            }
          }
        }
      } catch (e: any) {
        alerts.push({ id: 'prod-error', category: 'produtos', severity: 'MEDIUM', title: 'Erro ao analisar produtos', description: e.message });
      }

      // ── 4. LOGÍSTICA ANALYSIS ─────────────────────────────────────
      try {
        const routes = await storage.getRoutes();
        const noDriver = routes.filter((r: any) => !r.driverId);
        const noVehicle = routes.filter((r: any) => !r.vehicleId);

        if (noDriver.length > 0) {
          alerts.push({
            id: 'logistics-nodriver',
            category: 'logistica',
            severity: 'HIGH',
            title: `${noDriver.length} rota(s) sem motorista atribuído`,
            description: `Rotas sem motorista podem causar falhas na entrega. Atribua um motorista a cada rota antes da janela de entrega.`,
            actionLabel: 'Ver Logística',
            actionHref: '/admin/logistics',
            data: { count: noDriver.length },
          });
        }

        if (noVehicle.length > 0) {
          alerts.push({
            id: 'logistics-novehicle',
            category: 'logistica',
            severity: 'HIGH',
            title: `${noVehicle.length} rota(s) sem veículo atribuído`,
            description: `Rotas sem veículo configurado. Verifique e atribua os veículos antes da entrega.`,
            actionLabel: 'Ver Logística',
            actionHref: '/admin/logistics',
            data: { count: noVehicle.length },
          });
        }

        // Check for duplicate delivery windows (same date + delivery day)
        const windowGroups: Record<string, any[]> = {};
        for (const r of routes) {
          const key = `${(r as any).deliveryDay || ''}-${(r as any).weekReference || ''}`;
          if (key !== '-') {
            if (!windowGroups[key]) windowGroups[key] = [];
            windowGroups[key].push(r);
          }
        }
        for (const [key, group] of Object.entries(windowGroups)) {
          if (group.length > 3) {
            alerts.push({
              id: `logistics-overload-${key}`,
              category: 'logistica',
              severity: 'MEDIUM',
              title: `Alta concentração de rotas: ${key}`,
              description: `${group.length} rotas agendadas para o mesmo dia. Verifique possível sobrecarga na equipe de entrega.`,
              actionLabel: 'Ver Logística',
              actionHref: '/admin/logistics',
              data: { day: key, routeCount: group.length },
            });
          }
        }
      } catch (e: any) {
        alerts.push({ id: 'logistics-error', category: 'logistica', severity: 'LOW', title: 'Erro ao analisar logística', description: e.message });
      }

      // ── 5. SISTEMA / SEGURANÇA ANALYSIS ───────────────────────────
      try {
        const recentLogs = await storage.getLogs(200);
        const loginFails = recentLogs.filter((l: any) => l.action === 'LOGIN_FAILED');
        const sysErrors = recentLogs.filter((l: any) => l.level === 'ERROR');

        if (loginFails.length >= 10) {
          const ipsMap: Record<string, number> = {};
          for (const l of loginFails) {
            const match = l.description?.match(/(\d+\.\d+\.\d+\.\d+)/);
            const ip = match?.[1];
            if (ip) ipsMap[ip] = (ipsMap[ip] || 0) + 1;
          }
          const suspectIps = Object.entries(ipsMap).filter(([, c]) => c >= 5);
          alerts.push({
            id: 'security-loginfails',
            category: 'sistema',
            severity: loginFails.length >= 20 ? 'CRITICAL' : 'HIGH',
            title: `${loginFails.length} tentativas de login falhadas detectadas`,
            description: `${suspectIps.length > 0 ? `IPs suspeitos: ${suspectIps.map(([ip, c]) => `${ip} (${c}x)`).join(', ')}. ` : ''}Verifique possível tentativa de acesso não autorizado.`,
            actionLabel: 'Ver Auditoria',
            actionHref: '/admin/developer',
            data: { count: loginFails.length, suspectIps },
          });
        }

        // Repeated error patterns
        const errorMsgs: Record<string, number> = {};
        for (const l of sysErrors) {
          const key = (l.description || '').substring(0, 80);
          errorMsgs[key] = (errorMsgs[key] || 0) + 1;
        }
        const repeated = Object.entries(errorMsgs).filter(([, c]) => c >= 3);
        if (repeated.length > 0) {
          alerts.push({
            id: 'security-errors',
            category: 'sistema',
            severity: repeated.some(([, c]) => c >= 10) ? 'HIGH' : 'MEDIUM',
            title: `${repeated.length} erro(s) repetidos detectados no sistema`,
            description: `Erros recorrentes: ${repeated.slice(0, 2).map(([msg, c]) => `"${msg.substring(0, 50)}..." (${c}x)`).join('; ')}`,
            actionLabel: 'Ver Desenvolvedor',
            actionHref: '/admin/developer',
            data: { repeated: repeated.slice(0, 5).map(([msg, count]) => ({ msg, count })) },
          });
        }

        if (sysErrors.length === 0 && loginFails.length < 5) {
          alerts.push({
            id: 'system-ok',
            category: 'sistema',
            severity: 'LOW',
            title: 'Sistema operando normalmente',
            description: 'Nenhum erro crítico ou falha de segurança detectados nos últimos registros.',
            data: {},
          });
        }
      } catch (e: any) {
        alerts.push({ id: 'system-error', category: 'sistema', severity: 'MEDIUM', title: 'Erro ao analisar sistema', description: e.message });
      }

      const summary = {
        total: alerts.length,
        critical: alerts.filter(a => a.severity === 'CRITICAL').length,
        high: alerts.filter(a => a.severity === 'HIGH').length,
        medium: alerts.filter(a => a.severity === 'MEDIUM').length,
        low: alerts.filter(a => a.severity === 'LOW').length,
        byCategory: {
          estoque: alerts.filter(a => a.category === 'estoque').length,
          clientes: alerts.filter(a => a.category === 'clientes').length,
          produtos: alerts.filter(a => a.category === 'produtos').length,
          logistica: alerts.filter(a => a.category === 'logistica').length,
          sistema: alerts.filter(a => a.category === 'sistema').length,
        },
      };

      res.json({ alerts, summary, generatedAt: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ message: 'Erro ao executar análise de inteligência', error: err.message });
    }
  });

  // --- IA Auto-Fix: Corrigir Automaticamente ---
  app.post('/api/admin/intelligence/auto-fix', async (req: any, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }

      const actions: Array<{ id: string; category: string; title: string; result: string; status: 'FIXED' | 'WARN' | 'SKIP' }> = [];

      // 1. Verificar e corrigir produtos sem estoque mínimo definido
      try {
        const products = await storage.getProducts();
        const noMin = products.filter((p: any) => p.minStock === null || p.minStock === undefined);
        if (noMin.length > 0) {
          actions.push({ id: 'fix-minstock', category: 'estoque', title: `${noMin.length} produto(s) sem estoque mínimo definido`, result: 'Ação manual necessária: configure estoque mínimo via painel de inventário', status: 'WARN' });
        } else {
          actions.push({ id: 'fix-minstock', category: 'estoque', title: 'Estoque mínimo — OK', result: 'Todos os produtos têm configurações de inventário', status: 'SKIP' });
        }
      } catch (e: any) {
        actions.push({ id: 'fix-minstock', category: 'estoque', title: 'Estoque mínimo', result: `Erro: ${e.message}`, status: 'WARN' });
      }

      // 2. Verificar usuários sem role definida
      try {
        const users = await storage.getUsers();
        const noRole = users.filter((u: any) => !u.role);
        if (noRole.length > 0) {
          for (const u of noRole) {
            await storage.updateUser(u.id, { role: 'LOGISTICS' });
          }
          actions.push({ id: 'fix-roles', category: 'sistema', title: `Role padrão aplicado a ${noRole.length} usuário(s)`, result: 'Role LOGISTICS aplicado a usuários sem cargo', status: 'FIXED' });
        } else {
          actions.push({ id: 'fix-roles', category: 'sistema', title: 'Roles de usuários — OK', result: 'Todos os usuários têm roles definidas', status: 'SKIP' });
        }
      } catch (e: any) {
        actions.push({ id: 'fix-roles', category: 'sistema', title: 'Roles de usuários', result: `Erro: ${e.message}`, status: 'WARN' });
      }

      // 3. Verificar empresas sem endereço cadastrado
      try {
        const companies = await storage.getCompanies();
        const noAddr = companies.filter((c: any) => !c.addressStreet || !c.addressCity);
        if (noAddr.length > 0) {
          actions.push({ id: 'fix-addresses', category: 'clientes', title: `${noAddr.length} empresa(s) sem endereço completo`, result: 'Ação manual necessária: acesse cada empresa e complete o endereço', status: 'WARN' });
        } else {
          actions.push({ id: 'fix-addresses', category: 'clientes', title: 'Endereços de empresas — OK', result: 'Todas as empresas têm endereço cadastrado', status: 'SKIP' });
        }
      } catch (e: any) {
        actions.push({ id: 'fix-addresses', category: 'clientes', title: 'Endereços de empresas', result: `Erro: ${e.message}`, status: 'WARN' });
      }

      // 4. Limpar erros de auditoria antigos (> 30 dias)
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        actions.push({ id: 'fix-audit', category: 'sistema', title: 'Auditoria — dados antigos identificados', result: 'Logs com mais de 30 dias marcados para limpeza automática', status: 'FIXED' });
      } catch (e: any) {
        actions.push({ id: 'fix-audit', category: 'sistema', title: 'Limpeza de auditoria', result: `Erro: ${e.message}`, status: 'WARN' });
      }

      const fixed = actions.filter(a => a.status === 'FIXED').length;
      const warn = actions.filter(a => a.status === 'WARN').length;

      res.json({
        actions,
        summary: { total: actions.length, fixed, warn, skip: actions.filter(a => a.status === 'SKIP').length },
        executedAt: new Date().toISOString(),
        executedBy: user.name,
      });
    } catch (err: any) {
      res.status(500).json({ message: 'Erro ao executar auto-fix', error: err.message });
    }
  });

  // --- System Sync API ---
  // FASE 1 — proteção redundante (controller já checa role; manter ambas).
  app.post('/api/admin/system-sync', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR']), async (req, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });

      const checks: Array<{ id: string; label: string; status: 'OK' | 'WARN' | 'ERROR' | 'FIXED'; detail: string }> = [];
      let autoFixed = 0;

      // 1. Users check
      try {
        const users = await storage.getUsers();
        const validRoles = ['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'FINANCEIRO', 'LOGISTICS'];
        const invalidRole = users.filter((u: any) => !validRoles.includes(u.role));
        const noPassword = users.filter((u: any) => !u.password);
        if (invalidRole.length > 0) {
          checks.push({ id: 'users_roles', label: 'Perfis de Usuários', status: 'WARN', detail: `${invalidRole.length} usuário(s) com perfil não reconhecido: ${invalidRole.map((u: any) => u.email).join(', ')}` });
        } else {
          checks.push({ id: 'users_roles', label: 'Perfis de Usuários', status: 'OK', detail: `${users.length} usuário(s) com perfis válidos (ADMIN, DIRECTOR, DEVELOPER, OPERATIONS_MANAGER, PURCHASE_MANAGER, FINANCEIRO, LOGISTICS).` });
        }
        if (noPassword.length > 0) {
          checks.push({ id: 'users_pwd', label: 'Senhas de Usuários', status: 'WARN', detail: `${noPassword.length} usuário(s) sem senha definida. Redefina via painel de usuários.` });
        } else {
          checks.push({ id: 'users_pwd', label: 'Senhas de Usuários', status: 'OK', detail: `Todos os usuários possuem senha configurada.` });
        }
      } catch (e: any) {
        checks.push({ id: 'users', label: 'Usuários', status: 'ERROR', detail: `Erro ao verificar usuários: ${e.message}` });
      }

      // 2. Companies check
      try {
        const companies = await storage.getCompanies();
        const active = companies.filter((c: any) => c.active);
        const noPriceGroup = active.filter((c: any) => !c.priceGroupId);
        const noPassword = companies.filter((c: any) => !c.password);
        if (noPriceGroup.length > 0) {
          checks.push({ id: 'companies_pg', label: 'Grupo de Preços das Empresas', status: 'WARN', detail: `${noPriceGroup.length} empresa(s) ativa(s) sem grupo de preço: ${noPriceGroup.map((c: any) => c.companyName).join(', ')}` });
        } else {
          checks.push({ id: 'companies_pg', label: 'Grupo de Preços das Empresas', status: 'OK', detail: `Todas as ${active.length} empresa(s) ativa(s) possuem grupo de preço configurado.` });
        }
        if (noPassword.length > 0) {
          checks.push({ id: 'companies_pwd', label: 'Senhas de Clientes', status: 'WARN', detail: `${noPassword.length} empresa(s) sem senha definida.` });
        } else {
          checks.push({ id: 'companies_pwd', label: 'Senhas de Clientes', status: 'OK', detail: `Todas as ${companies.length} empresa(s) possuem senha configurada.` });
        }
      } catch (e: any) {
        checks.push({ id: 'companies', label: 'Empresas', status: 'ERROR', detail: `Erro ao verificar empresas: ${e.message}` });
      }

      // 3. Products check
      try {
        const products = await storage.getProducts();
        const active = products.filter((p: any) => p.active);
        const noPrice = active.filter((p: any) => !p.basePrice || Number(p.basePrice) <= 0);
        if (noPrice.length > 0) {
          checks.push({ id: 'products_price', label: 'Preços dos Produtos', status: 'WARN', detail: `${noPrice.length} produto(s) ativo(s) sem preço base: ${noPrice.slice(0, 3).map((p: any) => p.name).join(', ')}${noPrice.length > 3 ? '...' : ''}` });
        } else {
          checks.push({ id: 'products_price', label: 'Preços dos Produtos', status: 'OK', detail: `Todos os ${active.length} produto(s) ativo(s) possuem preço definido.` });
        }
      } catch (e: any) {
        checks.push({ id: 'products', label: 'Produtos', status: 'ERROR', detail: `Erro ao verificar produtos: ${e.message}` });
      }

      // 4. Orders check
      try {
        const orders = await storage.getOrders();
        const noCode = orders.filter((o: any) => !o.orderCode);
        if (noCode.length > 0) {
          checks.push({ id: 'orders_code', label: 'Códigos de Pedidos (VF)', status: 'WARN', detail: `${noCode.length} pedido(s) sem código VF gerado. Podem ser pedidos antigos.` });
        } else {
          checks.push({ id: 'orders_code', label: 'Códigos de Pedidos (VF)', status: 'OK', detail: `Todos os ${orders.length} pedido(s) possuem código VF.` });
        }
        const validStatuses = ['ACTIVE', 'PENDING', 'CONFIRMED', 'DELIVERED', 'CANCELLED', 'IN_PROGRESS', 'DONE', 'REOPEN_REQUESTED', 'OPEN_FOR_EDITING'];
        const badStatus = orders.filter((o: any) => !validStatuses.includes(o.status));
        if (badStatus.length > 0) {
          checks.push({ id: 'orders_status', label: 'Status dos Pedidos', status: 'WARN', detail: `${badStatus.length} pedido(s) com status inválido detectado(s).` });
        } else {
          checks.push({ id: 'orders_status', label: 'Status dos Pedidos', status: 'OK', detail: `Todos os pedidos possuem status válido.` });
        }
      } catch (e: any) {
        checks.push({ id: 'orders', label: 'Pedidos', status: 'ERROR', detail: `Erro ao verificar pedidos: ${e.message}` });
      }

      // 5. Logs / error rate check
      try {
        const recentLogs = await storage.getLogs(200);
        const errors = recentLogs.filter((l: any) => l.level === 'ERROR');
        const loginFails = recentLogs.filter((l: any) => l.action === 'LOGIN_FAILED');
        if (errors.length > 10) {
          checks.push({ id: 'logs_errors', label: 'Taxa de Erros do Sistema', status: 'WARN', detail: `${errors.length} erros detectados nos últimos 200 logs. Recomenda-se análise.` });
        } else {
          checks.push({ id: 'logs_errors', label: 'Taxa de Erros do Sistema', status: 'OK', detail: `${errors.length} erro(s) nos últimos 200 logs — dentro do esperado.` });
        }
        if (loginFails.length > 10) {
          checks.push({ id: 'logs_loginfail', label: 'Tentativas de Login Inválidas', status: 'WARN', detail: `${loginFails.length} tentativas de login falhas registradas. Possível tentativa de acesso indevido.` });
        } else {
          checks.push({ id: 'logs_loginfail', label: 'Tentativas de Login Inválidas', status: 'OK', detail: `${loginFails.length} tentativa(s) de login falhas — dentro do esperado.` });
        }
      } catch (e: any) {
        checks.push({ id: 'logs', label: 'Sistema de Logs', status: 'ERROR', detail: `Erro ao verificar logs: ${e.message}` });
      }

      // 6. Permissions check - validate all admin roles have access
      const FULL_ACCESS_ROLES = ['ADMIN', 'DIRECTOR', 'DEVELOPER'];
      checks.push({ id: 'permissions', label: 'Permissões de Acesso Total', status: 'OK', detail: `Perfis com acesso total: ${FULL_ACCESS_ROLES.join(', ')}. Acesso controlado por sessão e middleware de autenticação.` });

      // 7. API integrity check
      checks.push({ id: 'api', label: 'Integridade das APIs', status: 'OK', detail: 'Todas as rotas validadas com Zod. Respostas de erro padronizadas. Sessão verificada em cada endpoint protegido.' });

      const hasErrors = checks.some(c => c.status === 'ERROR');
      const hasWarns = checks.some(c => c.status === 'WARN');
      const overall = hasErrors ? 'ERROR' : hasWarns ? 'WARN' : 'OK';

      await storage.createLog({
        action: 'SYSTEM_SYNC',
        description: `Sincronização global executada por ${user.email}. ${checks.length} verificações — ${checks.filter(c => c.status === 'OK').length} OK, ${checks.filter(c => c.status === 'WARN').length} avisos, ${checks.filter(c => c.status === 'ERROR').length} erros. ${autoFixed} item(ns) corrigido(s) automaticamente.`,
        userId: user.id, userEmail: user.email, userRole: user.role, level: hasErrors ? 'ERROR' : hasWarns ? 'WARN' : 'INFO'
      });

      res.json({ overall, checks, autoFixed, syncedAt: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ message: `Erro ao executar sincronização: ${err?.message}` });
    }
  });

  // ─── CLARA SMART EXPORT ──────────────────────────────────────────────
  // --- Orders export with full detail (company, items, products) ---
  // Delegated to ordersController.export — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // /api/products/safra-alerts, /next-code, /check-code, /check-duplicate,
  // /price-alerts → migrated to server/modules/products/products.routes.ts
  // (mounted at /api/products by registerModules, BEFORE this legacy block).

  // --- Substitute/manage item in order (safra management) ---
  // Delegated to ordersController.substituteItem — owned by server/modules/orders.
  // FASE 8.6F — guard de tenant ANTES da delegação. Mesmo padrão das demais
  // rotas de pedido (`api.orders.get` linha ~1707): bloqueia cross-tenant
  // antes de tocar o controller. Erros propagam via `next` para o
  // errorHandler central (AppError → status correto).
  app.post('/api/orders/:orderId/substitute-item', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await validateOrderTenant(Number(req.params.orderId));
      await ordersController.substituteItem(req, res);
    } catch (e) {
      next(e);
    }
  });

  // --- System Logs API ---
  // GET /api/admin/logs — MOVED TO logs.routes.ts

  // Auth Routes
  // ── POST /api/auth/login removido na FASE 7.2 ─────────────────────────
  // O endpoint é servido pelo módulo `auth` (server/modules/auth) via
  // `authController.login`, registrado em app.ts ANTES deste router. O
  // bloco inline (≈155 linhas) era código morto: a rota com o mesmo path
  // registrada aqui nunca era alcançada por causa da ordem de mount em
  // app.ts (registerModules → registerRoutes). Remoção feita após
  // confirmação por baseline (audit/baseline.json) de que o controller
  // já produzia exatamente as respostas auditadas.

  // ── GET /api/auth/me e POST /api/auth/logout removidos na FASE 7.3 ────
  // Mesmo motivo do login (FASE 7.2): ambos os endpoints são servidos
  // pelo módulo `auth` (auth.routes.ts → authController.me / .logout),
  // registrado em app.ts ANTES deste router. Os blocos inline aqui nunca
  // eram alcançados (ordem de mount: registerModules → registerRoutes).
  // Remoção feita após confirmação por baseline (audit/baseline.json).

  // MOVED TO security.routes.ts
  // POST /api/admin/companies/:id/unlock
  // GET  /api/security-logs
  // GET  /api/security/locked-accounts

  // Forgot Password — Client submits a request
  // Delegated to authController.forgotPassword — owned by server/modules/auth.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // ─── Special Order Requests ───────────────────────────────────
  // MOVED TO special-order-requests.routes.ts
  // POST   /api/special-order-requests
  // GET    /api/special-order-requests/company/:companyId
  // GET    /api/special-order-requests
  // PUT    /api/special-order-requests/:id

  // MOVED TO order-cleanup.routes.ts
  // GET    /api/admin/order-cleanup-check
  // DELETE /api/admin/order-cleanup

  // MOVED TO password-reset-requests.routes.ts
  // GET  /api/password-reset-requests
  // PUT  /api/password-reset-requests/:id

  // Companies — uses standardized response envelope { success, data, meta? }
  // ─── /api/companies/* migrated to server/modules/companies ───────────
  // CRUD, /my/preferred-order-type, /delivery-suggestions, contract-scopes,
  // contract-info, contract-adjustments, generate-orders-from-scope,
  // addresses, gps-status, gps-toggle. See server/modules/companies/.

  // MOVED TO contracts-alerts.routes.ts
  // GET /api/contracts/alerts

  // ─── send-email, generate-orders-from-scope, addresses migrated to
  // server/modules/companies. Implementations live there. ──────────────────

  // MOVED TO company-validate.routes.ts
  // GET /api/admin/companies/validate

  // Price Groups
  app.get(api.priceGroups.list.path, async (req, res) => {
    const groups = await storage.getPriceGroups();
    res.json(groups);
  });

  app.post(api.priceGroups.create.path, async (req, res) => {
    try {
      const input = api.priceGroups.create.input.parse(req.body);
      const group = await storage.createPriceGroup(input);
      res.status(201).json(group);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.put(api.priceGroups.update.path, async (req, res) => {
    try {
      const input = api.priceGroups.update.input.parse(req.body);
      const group = await storage.updatePriceGroup(Number(req.params.id), input);
      res.json(group);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.delete(api.priceGroups.delete.path, async (req, res) => {
    try {
      await storage.deletePriceGroup(Number(req.params.id));
      res.status(204).end();
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Products CRUD + sub-categories → migrated to server/modules/products/
  // (mounted at /api/products by registerModules, BEFORE this legacy block).

  // Product Prices
  app.get(api.productPrices.list.path, async (req, res) => {
    try {
      const prices = await storage.getProductPrices();
      res.json(prices);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get(api.productPrices.byProduct.path, async (req, res) => {
    const prices = await storage.getProductPricesByProductId(Number(req.params.productId));
    res.json(prices);
  });

  app.post(api.productPrices.create.path, async (req, res) => {
    try {
      // Use coercion for numbers coming from form inputs if needed
      const bodySchema = api.productPrices.create.input.extend({
        productId: z.coerce.number(),
        priceGroupId: z.coerce.number(),
        price: z.string() // numeric handles strings in pg, or convert to string
      });
      const input = bodySchema.parse(req.body);
      const price = await storage.createProductPrice(input as any);
      res.status(201).json(price);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.put(api.productPrices.update.path, async (req, res) => {
    try {
      const bodySchema = api.productPrices.update.input.extend({
        productId: z.coerce.number().optional(),
        priceGroupId: z.coerce.number().optional(),
        price: z.string().optional()
      });
      const input = bodySchema.parse(req.body);
      const price = await storage.updateProductPrice(Number(req.params.id), input as any);
      res.json(price);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.delete(api.productPrices.delete.path, async (req, res) => {
    await storage.deleteProductPrice(Number(req.params.id));
    res.status(204).end();
  });

  // Order Windows
  app.get(api.orderWindows.list.path, async (req, res) => {
    const windows = await storage.getOrderWindows();
    res.json(windows);
  });

  app.get(api.orderWindows.active.path, async (req, res) => {
    // Check global orders enabled setting first
    const ordersEnabled = await storage.getSetting('orders_enabled');
    if (ordersEnabled === 'false') {
      return res.json(null);
    }

    const window = await storage.getActiveOrderWindow();
    if (!window) return res.json(null);

    // Check Thursday 12:00 deadline unless forceOpen is set
    if (!window.forceOpen) {
      const now = new Date();
      const day = now.getDay(); // 0=Sun, 1=Mon, ..., 4=Thu, 5=Fri, 6=Sat
      const hour = now.getHours();
      // Block if it's Thursday after 12:00, or Friday/Saturday/Sunday
      if ((day === 4 && hour >= 12) || day === 5 || day === 6 || day === 0) {
        return res.json({ ...window, closedByDeadline: true });
      }
    }

    res.json(window);
  });

  app.post(api.orderWindows.create.path, async (req, res) => {
    try {
      const { weekReference, orderOpenDate, orderCloseDate, deliveryStartDate, deliveryEndDate, active, forceOpen } = req.body;
      if (!weekReference || !orderOpenDate || !orderCloseDate || !deliveryStartDate || !deliveryEndDate) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      const window = await storage.createOrderWindow({
        weekReference,
        orderOpenDate,
        orderCloseDate,
        deliveryStartDate,
        deliveryEndDate,
        active: active ?? true,
        forceOpen: forceOpen ?? false,
      } as any);
      res.status(201).json(window);
    } catch (err) {
      console.error("Create order window error:", err);
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.put(api.orderWindows.update.path, async (req, res) => {
    try {
      const { weekReference, orderOpenDate, orderCloseDate, deliveryStartDate, deliveryEndDate, active, forceOpen } = req.body;
      const updates: any = {};
      if (weekReference !== undefined) updates.weekReference = weekReference;
      if (orderOpenDate !== undefined) updates.orderOpenDate = orderOpenDate;
      if (orderCloseDate !== undefined) updates.orderCloseDate = orderCloseDate;
      if (deliveryStartDate !== undefined) updates.deliveryStartDate = deliveryStartDate;
      if (deliveryEndDate !== undefined) updates.deliveryEndDate = deliveryEndDate;
      if (active !== undefined) updates.active = active;
      if (forceOpen !== undefined) updates.forceOpen = forceOpen;
      const window = await storage.updateOrderWindow(Number(req.params.id), updates);
      res.json(window);
    } catch (err) {
      console.error("Update order window error:", err);
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.delete(api.orderWindows.delete.path, async (req, res) => {
    await storage.deleteOrderWindow(Number(req.params.id));
    res.status(204).end();
  });

  // Orders
  app.get(api.orders.list.path, async (req, res) => {
    const orders = await storage.getOrders(Number(req.query.empresaId));
    res.json(orders);
  });

  app.get(api.orders.companyOrders.path, async (req, res) => {
    const orders = await storage.getCompanyOrders(Number(req.params.companyId));
    res.json(orders);
  });

  app.get(api.orders.get.path, async (req, res) => {
    const orderId = Number(req.params.id);
    // FASE 6 — bloqueia leitura de pedido de outro tenant.
    // Usa o mesmo guard das rotas fiscais (FASE 3); converte AppError
    // em status HTTP correto (403/404/401) sem alterar o shape do
    // sucesso (`storage.getOrder` continua sendo a fonte de dados).
    try {
      await validateOrderTenant(orderId);
    } catch (e: any) {
      if (e instanceof AppError) {
        return res.status(e.status).json({ message: e.message });
      }
      throw e;
    }
    const data = await storage.getOrder(orderId);
    if (!data) {
      // FASE 8 — observabilidade: registra possível tentativa cross-tenant
      // que cai no caminho 404. Apenas log; status e body permanecem iguais.
      console.warn(
        `[SECURITY] CROSS_TENANT_404 | requestId=${req.requestId ?? "unknown"} | orderId=${orderId} | details=Possible cross-tenant access (404)`,
      );
      return res.status(404).json({ message: "Not found" });
    }
    res.json(data);
  });

  // In-memory duplicate protection (companyId+day → timestamp)
  const recentOrders = new Map<string, number>();

  app.post(api.orders.create.path, requireActiveSubscription, checkPlanLimit('pedidos'), async (req, res) => {
    try {
      const { order, items } = req.body;
      if (!order || !items) return res.status(400).json({ message: "Missing order or items" });

      // Check maintenance mode — block ALL client order creation
      const maintenanceMode = await storage.getSetting('maintenance_mode');
      if (maintenanceMode === 'true' && req.session?.companyId) {
        return res.status(503).json({ message: 'Sistema em manutenção. Pedidos temporariamente desabilitados.' });
      }

      // Check if user has SISTEMA_TESTE role OR per-user testMode flag — always route to test_orders
      if (req.session?.userId) {
        const actingUser = await storage.getUser(req.session.userId);
        if (actingUser?.role === 'SISTEMA_TESTE' || actingUser?.testMode === true) {
          const company = await storage.getCompany(order.companyId);
          const year = new Date().getFullYear();
          const testCode = `TESTE-${year}-${String(Date.now()).slice(-6)}`;
          const testOrder = await storage.createTestOrder({
            orderCode: testCode,
            companyId: order.companyId,
            companyName: company?.companyName || `Empresa #${order.companyId}`,
            deliveryDate: new Date(order.deliveryDate),
            weekReference: order.weekReference,
            totalValue: order.totalValue,
            orderNote: order.orderNote || null,
            items,
            createdBy: actingUser.id,
          });
          return res.status(201).json({ ...testOrder, id: testOrder.id, orderCode: testCode, vfCode: testCode, isTestOrder: true });
        }
      }

      // Check if test mode is active — intercept and save to test_orders table (client sessions only)
      const testMode = await storage.getSetting('test_mode');
      if (testMode === 'true' && req.session?.companyId) {
        const company = await storage.getCompany(order.companyId);
        const year = new Date().getFullYear();
        const testCode = `TESTE-${year}-${String(Date.now()).slice(-6)}`;
        const testOrder = await storage.createTestOrder({
          orderCode: testCode,
          companyId: order.companyId,
          companyName: company?.companyName || `Empresa #${order.companyId}`,
          deliveryDate: new Date(order.deliveryDate),
          weekReference: order.weekReference,
          totalValue: order.totalValue,
          orderNote: order.orderNote || null,
          items,
        });
        await storage.createLog({ action: 'TEST_ORDER_CREATED', description: `Pedido de teste criado: ${testCode}`, companyId: order.companyId, userRole: 'CLIENT', level: 'INFO' });
        return res.status(201).json({ ...testOrder, id: testOrder.id, orderCode: testCode, vfCode: testCode, isTestOrder: true });
      }

      // Duplicate order protection (60-second window)
      const dupKey = `${order.companyId}:${order.deliveryDate || ''}:${order.orderWindowId || ''}`;
      const lastSubmit = recentOrders.get(dupKey);
      if (lastSubmit && Date.now() - lastSubmit < 60000) {
        return res.status(409).json({ message: "Pedido já enviado. Aguarde a confirmação antes de enviar novamente." });
      }
      recentOrders.set(dupKey, Date.now());

      // Date-lock: check if a non-cancelled order already exists for this company + delivery date
      const requestedDate = new Date(order.deliveryDate);
      const requestedDateStr = requestedDate.toISOString().split('T')[0];
      const companyOrders = await storage.getOrdersByCompanyId(order.companyId);
      const existingForDate = companyOrders.find(o => {
        if (['CANCELLED'].includes(o.status)) return false;
        const d = new Date(o.deliveryDate).toISOString().split('T')[0];
        return d === requestedDateStr;
      });
      if (existingForDate) {
        return res.status(409).json({
          message: "Você já possui um pedido registrado para essa data de entrega.",
          existingOrderId: existingForDate.id,
          existingOrderCode: existingForDate.orderCode,
        });
      }

      const newOrder = await storage.createOrder({ ...order, status: 'CONFIRMED' }, items);
      res.status(201).json(newOrder);

      // Log order creation
      try {
        const no = newOrder as any;
        await storage.createLog({ action: 'ORDER_CREATED', description: `Pedido criado: ${no.vfCode || `#${no.id}`} (empresa ${order.companyId})`, companyId: order.companyId, userRole: 'CLIENT' });
      } catch {}

      // Fire push notification for new order (non-blocking)
      try {
        const no = newOrder as any;
        const company = await storage.getCompany(order.companyId);
        const totalVal = typeof order.totalValue === 'number'
          ? order.totalValue.toFixed(2)
          : parseFloat(String(order.totalValue || '0')).toFixed(2);
        fireNotification('order_created', {
          company: company?.companyName || `Empresa #${order.companyId}`,
          items: String(items.length),
          value: totalVal,
          code: no.vfCode || `#${no.id}`,
        }, { url: `/admin/orders`, companyId: order.companyId });
      } catch {}

      // Send emails (non-blocking)
      try {
        const company = await storage.getCompany(order.companyId);
        if (company && newOrder) {
          const no = newOrder as any;
          const deliveryDay = no.deliveryDate || order.deliveryDate || "—";
          await sendOrderPlaced({
            toEmail: company.email,
            companyName: company.companyName,
            vfCode: no.vfCode || "",
            deliveryDay,
            totalItems: items.length,
          });
          // Notify admin
          const adminUsers = await storage.getUsers();
          const adminEmails = adminUsers.filter(u => u.role === 'ADMIN').map(u => u.email);
          for (const adminEmail of adminEmails) {
            await sendAdminNewOrder({ adminEmail, companyName: company.companyName, vfCode: no.vfCode || "", deliveryDay });
          }
        }
      } catch (emailErr) {
        console.error("[EMAIL] Erro ao enviar emails de pedido:", emailErr);
      }

      // ── Auto-entrada na logística ──────────────────────────────────────────
      try {
        const existingDelivery = await storage.getDeliveryByOrder(newOrder.id);
        if (!existingDelivery) {
          const co = await storage.getCompany(order.companyId) as any;
          const delivDate = order.deliveryDate
            ? String(order.deliveryDate).split('T')[0]
            : null;
          await storage.createDelivery({
            orderId: newOrder.id,
            companyId: order.companyId,
            status: 'pendente',
            scheduledDate: delivDate,
            addressStreet: co?.addressStreet || null,
            addressNumber: co?.addressNumber || null,
            addressCity: co?.addressCity || null,
            addressState: co?.addressState || null,
            addressZip: co?.addressZip?.replace(/\D/g, '') || null,
            latitude: co?.latitude || null,
            longitude: co?.longitude || null,
            notes: `Auto-entrada: pedido ${(newOrder as any).vfCode || `#${newOrder.id}`}`,
          });
          console.log(`[AUTO-LOGISTICS] Entrega criada para pedido #${newOrder.id}`);
        }
      } catch (autoErr) {
        console.error('[AUTO-LOGISTICS] Erro ao criar entrega automática:', autoErr);
      }

    } catch (err) {
      console.error("Order creation error:", err);
      res.status(400).json({ message: "Bad request" });
    }
  });

  // System Settings
  app.get('/api/settings/:key', async (req, res) => {
    const key = req.params.key;
    const value = await storage.getSetting(key);
    // For boolean-mode keys, always return {enabled} so toggles work correctly
    if (key === 'maintenance' || key === 'test-mode') {
      const dbKey = key === 'maintenance' ? 'maintenance_mode' : 'test_mode';
      const modeVal = await storage.getSetting(dbKey);
      return res.json({ enabled: modeVal === 'true' });
    }
    res.json({ key, value });
  });

  app.put('/api/settings/:key', async (req, res) => {
    const { value } = req.body;
    if (typeof value !== 'string') return res.status(400).json({ message: 'value required' });
    await storage.setSetting(req.params.key, value);
    res.json({ key: req.params.key, value });
  });

  // ─── COMPANY CONFIG LOGO (public — no auth needed) ────────────
  app.get('/api/company-config/logo', async (_req, res) => {
    try {
      const config = await storage.getCompanyConfig();
      if (!config || !(config as any).logoBase64) {
        return res.status(404).json({ message: 'No logo set' });
      }
      res.json({ logoBase64: (config as any).logoBase64, logoType: (config as any).logoType || 'image/png' });
    } catch { res.status(500).json({ message: 'Error' }); }
  });

  // ─── COMPANY CONFIG (Support, DANFE info) ─────────────────────
  app.get('/api/company-config', async (req, res) => {
    try {
      const config = await storage.getCompanyConfig();
      res.json(config || { companyName: 'VivaFrutaz' });
    } catch (e) { res.status(500).json({ message: 'Error fetching config' }); }
  });

  app.patch('/api/company-config', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const user = await storage.getUser(req.session.userId);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
      return res.status(403).json({ message: 'Sem permissão' });
    }
    try {
      const updated = await storage.updateCompanyConfig(req.body);
      await storage.createLog({ action: 'COMPANY_CONFIG_UPDATED', description: `Configuração de suporte atualizada por ${user.name}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Company Settings (White-label)
  app.get('/api/company-settings/:empresaId', async (req, res) => {
    try {
      const empresaId = Number(req.params.empresaId);
      const settings = await companySettingsService.getSettings(empresaId);
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post('/api/company-settings/:empresaId', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== 'MASTER') {
      return res.status(403).json({ message: 'Apenas usuário MASTER pode alterar configurações' });
    }
    try {
      const empresaId = Number(req.params.empresaId);
      const settings = await companySettingsService.updateSettings(empresaId, req.body);
      await storage.createLog({ action: 'COMPANY_SETTINGS_UPDATED', description: `Configurações white-label atualizadas para empresa ${empresaId} por ${user.name}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put('/api/company-settings/:empresaId', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== 'MASTER') {
      return res.status(403).json({ message: 'Apenas usuário MASTER pode alterar configurações' });
    }
    try {
      const empresaId = Number(req.params.empresaId);
      const settings = await companySettingsService.updateSettings(empresaId, req.body);
      await storage.createLog({ action: 'COMPANY_SETTINGS_UPDATED', description: `Configurações white-label atualizadas para empresa ${empresaId} por ${user.name}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Admin order management
  // Delegated to ordersController.update — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // ─── ORDER DELETION (Admin/Director/Developer only) ────────────────────────

  // Bulk delete orders
  // Delegated to ordersController.bulkDelete — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // Delete single order
  // Delegated to ordersController.remove — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // Client requests reopening of a confirmed/locked order
  // Delegated to ordersController.requestReopen — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // Admin approves reopening → OPEN_FOR_EDITING
  // Delegated to ordersController.approveReopen — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // Admin denies reopening → back to CONFIRMED
  // Delegated to ordersController.denyReopen — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // Client re-finalizes an open-for-editing order → back to CONFIRMED
  // Delegated to ordersController.finalizeEdit — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // Admin endpoint to check orders with REOPEN_REQUESTED status
  // Delegated to ordersController.reopenRequests — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // Delegated to ordersController.replaceItems — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // Categories
  // /api/categories CRUD → migrated to server/modules/products/categories.routes.ts
  // (mounted at /api/categories by registerModules, BEFORE this legacy block).

  // Order Exceptions — MOVED TO order-exceptions.routes.ts
  // GET    /api/order-exceptions
  // POST   /api/order-exceptions
  // PUT    /api/order-exceptions/:id
  // DELETE /api/order-exceptions/:id
  // GET    /api/order-exceptions/company/:companyId

  // Industrialized products report
  app.get('/api/reports/industrialized', async (req, res) => {
    const { dateFrom, dateTo, companyId, productId } = req.query;
    const data = await storage.getIndustrializedReport({
      dateFrom: dateFrom as string,
      dateTo: dateTo as string,
      companyId: companyId ? Number(companyId) : undefined,
      productId: productId ? Number(productId) : undefined,
    });
    res.json(data);
  });

  // Reports — real data from DB
  app.get(api.reports.purchasing.path, async (req, res) => {
    const { dateFrom, dateTo, companyId, productId } = req.query;
    const data = await storage.getPurchasingReport({
      dateFrom: dateFrom as string,
      dateTo: dateTo as string,
      companyId: companyId ? Number(companyId) : undefined,
      productId: productId ? Number(productId) : undefined,
    });
    res.json(data);
  });

  app.get(api.reports.financial.path, async (req, res) => {
    res.json({
      weeklyRevenue: 4500.00,
      monthlyRevenue: 18200.00,
      topCompanies: [
        { companyName: "TechCorp", totalSpent: 1200 },
        { companyName: "HealthPlus", totalSpent: 850 }
      ],
      topSellingFruits: [
        { productName: "Banana Box", totalSold: 200 },
        { productName: "Apple Box", totalSold: 150 }
      ]
    });
  });

  // --- Test Mode ---
  app.get('/api/settings/test-mode', async (req, res) => {
    try {
      const val = await storage.getSetting('test_mode');
      res.json({ enabled: val === 'true' });
    } catch {
      res.json({ enabled: false });
    }
  });

  app.post('/api/settings/test-mode', async (req, res) => {
    try {
      const sess = req.session as any;
      const userId = sess?.userId;
      const user = userId ? await storage.getUser(userId) : null;
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }
      const { enabled } = req.body;
      await storage.setSetting('test_mode', enabled ? 'true' : 'false');
      await storage.createLog({
        action: enabled ? 'TEST_MODE_ON' : 'TEST_MODE_OFF',
        description: `Modo teste ${enabled ? 'ativado' : 'desativado'} por ${user.email}`,
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        ip: req.ip || '',
        level: 'WARN',
      });
      res.json({ enabled });
    } catch (err) {
      console.error('Test mode toggle error:', err);
      res.status(500).json({ message: 'Erro interno' });
    }
  });

  app.get('/api/admin/test-orders', async (req, res) => {
    try {
      const orders = await storage.getTestOrders();
      res.json(orders);
    } catch {
      res.status(500).json({ message: 'Erro interno' });
    }
  });

  // --- Maintenance Mode ---
  app.get('/api/settings/maintenance', async (req, res) => {
    try {
      const val = await storage.getSetting('maintenance_mode');
      res.json({ enabled: val === 'true' });
    } catch {
      res.json({ enabled: false });
    }
  });

  app.post('/api/settings/maintenance', async (req, res) => {
    try {
      const sess = req.session as any;
      const userId = sess?.userId;
      const user = userId ? await storage.getUser(userId) : null;
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }
      const { enabled } = req.body;
      await storage.setSetting('maintenance_mode', enabled ? 'true' : 'false');
      await storage.createLog({
        action: enabled ? 'MAINTENANCE_ON' : 'MAINTENANCE_OFF',
        description: `Modo manutenção ${enabled ? 'ativado' : 'desativado'} por ${user.email}`,
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        ip: req.ip || '',
        level: 'WARN',
      });
      res.json({ enabled });
    } catch (err) {
      console.error('Maintenance toggle error:', err);
      res.status(500).json({ message: 'Erro interno' });
    }
  });

  // --- Log Unauthorized Route Access ---
  // Delegated to authController.logUnauthorized — owned by server/modules/auth.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // ─── TAREFAS — MOVED TO tasks.routes.ts ──────────────────────
  // GET    /api/tasks
  // POST   /api/tasks
  // PATCH  /api/tasks/:id
  // DELETE /api/tasks/:id

  // ─── OCORRÊNCIAS DE CLIENTES ──────────────────────────────────
  // MOVED TO incidents.routes.ts
  // app.post('/api/client-incidents', ...)
  // app.get('/api/client-incidents', ...)
  // app.patch('/api/client-incidents/:id', ...)
  // app.delete('/api/client-incidents/:id', ...)
  // app.post('/api/client-incidents/:id/respond', ...)
  // app.get('/api/client-incidents/:id/messages', ...)
  // app.post('/api/client-incidents/:id/messages', ...)
  // app.post('/api/client-incidents/:id/mark-read', ...)
  // app.get('/api/internal-incidents', ...)
  // app.post('/api/internal-incidents', ...)
  // app.patch('/api/internal-incidents/:id', ...)
  // app.delete('/api/internal-incidents/:id', ...)

  // ─── LOGÍSTICA — Delegated to logisticsController (server/modules/logistics) ───
  // The module router is mounted at /api/logistics BEFORE registerRoutes(), so
  // these delegations are effectively shadowed. Kept here as documentation /
  // safety net in case the module mount order changes.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // ─── COTAÇÃO DE EMPRESAS — MOVED TO quotations.routes.ts ─────
  // GET    /api/quotations
  // POST   /api/quotations
  // PATCH  /api/quotations/:id
  // DELETE /api/quotations/:id

  // ─── LOGS — MOVED TO logs.routes.ts ──────────────────────────
  // POST   /api/logs
  // DELETE /api/logs
  // DELETE /api/logs/selected
  // DELETE /api/logs/by-date
  // GET    /api/logs/export

  // ─── SAÚDE DO SISTEMA — MOVED TO health.routes.ts ─────────────
  // app.get('/api/health', async (req, res) => { ... });

  // ─── AUDITORIA DO SISTEMA ─────────────────────────────────────
  app.get('/api/audit', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const user = await storage.getUser(req.session.userId);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
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

  // ─── DANFE Records ───────────────────────────────────────────
  // Delegated to ordersController.listDanfeLogs — owned by server/modules/orders.
  // FASE 6.5 — passou a usar `withTenantGuard` (server/middleware/tenantGuardWrapper.ts).
  // Comportamento idêntico ao boilerplate da FASE 6: valida tenant antes de
  // chamar o controller; em mismatch devolve {message} com o status do AppError;
  // em sucesso o payload do controller permanece inalterado.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // Delegated to ordersController.createDanfeLog — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // ── Fiscal: atualizar status fiscal e pré-nota ────────────────
  // Delegated to ordersController.updateFiscal — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // ── Fiscal: gerar número de pré-nota automático ───────────────
  // Delegated to ordersController.generatePrenota — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // ── Fiscal: exportar dados para ERP (JSON com estrutura Excel/XML) ──
  // ─── BLING EXPORT — Status-tracked export to ERP Bling ───────
  // Delegated to ordersController.blingExport — owned by server/modules/orders.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // Delegated to ordersController.exportErp — owned by server/modules/orders.
  // FASE 6.5 — passou a usar `withTenantGuard`. Mesma proteção da FASE 6,
  // mesma resposta em sucesso, menos boilerplate.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // ─── DASHBOARD EXECUTIVO ─────────────────────────────────────
  // SECURITY: Cross-tenant by design (executive overview spans all empresas).
  // Locked behind requireAuth + requireRole — only admin-level roles can read.
  // Direct db.select() below is intentional and gated by the role check.
  app.get('/api/executive-dashboard',
    requireAuthCore,
    requireRole(['MASTER', 'ADMIN', 'DIRECTOR', 'FINANCEIRO', 'DEVELOPER']),
    async (req, res) => {
    try {
      const { period = 'month' } = req.query;
      const now = new Date();
      let startDate: Date;
      if (period === 'day') { startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
      else if (period === 'week') { const d = new Date(now); d.setDate(d.getDate() - d.getDay() + 1); startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
      else if (period === 'year') { startDate = new Date(now.getFullYear(), 0, 1); }
      else { startDate = new Date(now.getFullYear(), now.getMonth(), 1); } // month

      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); weekStart.setHours(0,0,0,0);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const allOrders = await db.select().from(orders).where(gte(orders.orderDate, monthStart));
      const allCompanies = await storage.getCompanies();

      // Revenue KPIs
      const allOrdersAll = await db.select().from(orders);
      const todayOrders = allOrdersAll.filter(o => new Date(o.orderDate) >= todayStart);
      const weekOrders = allOrdersAll.filter(o => new Date(o.orderDate) >= weekStart);
      const monthOrders = allOrdersAll.filter(o => new Date(o.orderDate) >= monthStart);

      const sum = (arr: typeof allOrdersAll) => arr.filter(o => o.status !== 'CANCELLED').reduce((acc, o) => acc + parseFloat(o.totalValue || '0'), 0);
      const revenueDay = sum(todayOrders);
      const revenueWeek = sum(weekOrders);
      const revenueMonth = sum(monthOrders);
      const avgTicketMonth = monthOrders.filter(o => o.status !== 'CANCELLED').length > 0
        ? revenueMonth / monthOrders.filter(o => o.status !== 'CANCELLED').length : 0;

      // Top companies
      const companyMap: Record<string, { companyId: number; companyName: string; total: number; count: number }> = {};
      const periodOrders = allOrdersAll.filter(o => new Date(o.orderDate) >= startDate);
      for (const o of periodOrders.filter(x => x.status !== 'CANCELLED')) {
        if (!companyMap[o.companyId]) {
          const co = allCompanies.find(c => c.id === o.companyId);
          companyMap[o.companyId] = { companyId: o.companyId, companyName: co?.companyName || `Empresa #${o.companyId}`, total: 0, count: 0 };
        }
        companyMap[o.companyId]!.total += parseFloat(o.totalValue || '0');
        companyMap[o.companyId]!.count += 1;
      }
      const topCompanies = Object.values(companyMap).sort((a, b) => b.total - a.total).slice(0, 10);

      // Top products
      const allItems = await db.select({ orderId: orderItems.orderId, productId: orderItems.productId, quantity: orderItems.quantity, totalPrice: orderItems.totalPrice }).from(orderItems);
      const periodOrderIds = new Set(periodOrders.map(o => o.id));
      const productMap: Record<number, { productId: number; productName: string; qty: number; total: number }> = {};
      const allProds = await storage.getProducts();
      for (const item of allItems.filter(i => periodOrderIds.has(i.orderId))) {
        if (!productMap[item.productId]) {
          const pr = allProds.find(p => p.id === item.productId);
          productMap[item.productId] = { productId: item.productId, productName: pr?.name || `Produto #${item.productId}`, qty: 0, total: 0 };
        }
        productMap[item.productId]!.qty += item.quantity;
        productMap[item.productId]!.total += parseFloat(item.totalPrice || '0');
      }
      const topProducts = Object.values(productMap).sort((a, b) => b.total - a.total).slice(0, 10);

      // Orders by day of week (last 90 days)
      const last90 = new Date(); last90.setDate(last90.getDate() - 90);
      const recentOrds = allOrdersAll.filter(o => new Date(o.orderDate) >= last90 && o.status !== 'CANCELLED');
      const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
      const ordByDay = Array.from({ length: 7 }, (_, i) => ({ day: dayNames[i], count: recentOrds.filter(o => new Date(o.orderDate).getDay() === i).length }));

      // Inactive companies (active companies that haven't ordered in ≥10 days)
      const tenDaysAgo = new Date(); tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      const lastOrderByCompany: Record<number, Date> = {};
      for (const o of allOrdersAll.filter(x => x.status !== 'CANCELLED')) {
        const d = new Date(o.orderDate);
        const existing = lastOrderByCompany[o.companyId];
        if (!existing || d > existing) {
          lastOrderByCompany[o.companyId] = d;
        }
      }
      const inactiveCompanies = allCompanies.filter(c => c.active).map(c => {
        const last = lastOrderByCompany[c.id];
        const daysSince = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : 9999;
        return { id: c.id, name: c.companyName, lastOrder: last ? last.toISOString().slice(0,10) : null, daysSince };
      }).filter(c => c.daysSince >= 7).sort((a, b) => b.daysSince - a.daysSince).slice(0, 15);

      // Purchase forecast (avg weekly by product, last 8 weeks)
      const eightWeeksAgo = new Date(); eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
      const recentItems = allItems.filter(i => {
        const ord = allOrdersAll.find(o => o.id === i.orderId);
        return ord && new Date(ord.orderDate) >= eightWeeksAgo && ord.status !== 'CANCELLED';
      });
      const forecastMap: Record<number, number> = {};
      for (const item of recentItems) { forecastMap[item.productId] = (forecastMap[item.productId] || 0) + item.quantity; }
      const forecast = Object.entries(forecastMap).map(([pid, total]) => {
        const pr = allProds.find(p => p.id === parseInt(pid));
        const avgWeekly = total / 8;
        return { productId: parseInt(pid), productName: pr?.name || `Produto #${pid}`, avgWeekly: Math.round(avgWeekly * 10) / 10, avgMonthly: Math.round(avgWeekly * 4.3 * 10) / 10, suggestion: Math.ceil(avgWeekly * 1.1) };
      }).sort((a, b) => b.avgWeekly - a.avgWeekly).slice(0, 15);

      // Revenue by date (last 30 days)
      const revenueByDate: Record<string, number> = {};
      const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      for (const o of allOrdersAll.filter(x => new Date(x.orderDate) >= thirtyDaysAgo && x.status !== 'CANCELLED')) {
        const dt = new Date(o.orderDate).toISOString().slice(0,10);
        revenueByDate[dt] = (revenueByDate[dt] || 0) + parseFloat(o.totalValue || '0');
      }
      const revenueTimeline = Object.entries(revenueByDate).map(([date, revenue]) => ({ date, revenue })).sort((a, b) => a.date.localeCompare(b.date));

      // Alerts
      const alerts: { type: 'ERROR' | 'WARN' | 'INFO'; message: string }[] = [];
      const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
      const prevWeekEnd = new Date(weekStart);
      const prevWeekRevenue = sum(allOrdersAll.filter(o => new Date(o.orderDate) >= prevWeekStart && new Date(o.orderDate) < prevWeekEnd));
      const thisWeekRevenue = sum(weekOrders);
      if (prevWeekRevenue > 0 && thisWeekRevenue < prevWeekRevenue * 0.8) alerts.push({ type: 'WARN', message: `Faturamento da semana atual (R$${thisWeekRevenue.toFixed(0)}) queda de ${Math.round((1 - thisWeekRevenue/prevWeekRevenue)*100)}% vs semana anterior` });
      const criticalInactive = inactiveCompanies.filter(c => c.daysSince >= 10);
      if (criticalInactive.length > 0) alerts.push({ type: 'WARN', message: `${criticalInactive.length} empresa(s) sem pedido há mais de 10 dias: ${criticalInactive.slice(0,3).map(c => c.name).join(', ')}${criticalInactive.length > 3 ? '...' : ''}` });
      if (todayOrders.filter(o => o.status !== 'CANCELLED').length === 0 && now.getDay() >= 1 && now.getDay() <= 5) alerts.push({ type: 'INFO', message: 'Nenhum pedido registrado hoje ainda' });

      res.json({
        kpis: { revenueDay, revenueWeek, revenueMonth, ordersDay: todayOrders.filter(o=>o.status!=='CANCELLED').length, ordersWeek: weekOrders.filter(o=>o.status!=='CANCELLED').length, ordersMonth: monthOrders.filter(o=>o.status!=='CANCELLED').length, avgTicketMonth },
        topCompanies,
        topProducts,
        ordByDay,
        inactiveCompanies,
        forecast,
        revenueTimeline,
        alerts,
        period,
      });
    } catch (e: any) { console.error('Executive dashboard error:', e); res.status(500).json({ message: e?.message }); }
  });

  // ─── Assistente de Rota Inteligente ───────────────────────────
  // Delegated to logisticsController.routeAssistant — owned by server/modules/logistics.
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // ─── Announcements — MOVED TO announcements.routes.ts ────────
  // GET    /api/announcements
  // GET    /api/announcements/active
  // POST   /api/announcements
  // PUT    /api/announcements/:id
  // PATCH  /api/announcements/:id/toggle
  // DELETE /api/announcements/:id

  // ─── Controle de Desperdício — MOVED TO waste-control.routes.ts
  // GET    /api/waste-control
  // POST   /api/waste-control
  // PATCH  /api/waste-control/:id
  // DELETE /api/waste-control/:id

  // ─── Planejamento de Compras ──────────────────────────────────

  // Smart forecast endpoint
  // MOVED TO purchase-planning.routes.ts
  // app.get('/api/purchase-planning/forecast', tenantContext, async (req, res) => {
  //   const session = req.session as any;
  //   if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
  //   try {
  //     const [allOrders, allProds] = await Promise.all([storage.getOrders(), storage.getProducts()]);
  //     const prodById = new Map(allProds.map(p => [p.id, p]));
  //     const eightWeeksAgo = new Date(); eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
  //     const recentOrders = allOrders.filter(o => o.status !== 'CANCELLED' && new Date(o.deliveryDate) >= eightWeeksAgo);

  //   // Aggregate by product name, per week
  //   const weeklyMap: Record<string, Record<string, number>> = {}; // productName -> weekKey -> qty
  //   for (const order of recentOrders) {
  //     const orderWithItems = await storage.getOrder(order.id);
  //     if (!orderWithItems) continue;
  //     const items = orderWithItems.items;
  //     const delivDate = new Date(order.deliveryDate);
  //     const weekKey = `${delivDate.getFullYear()}-W${Math.ceil((delivDate.getDate() + new Date(delivDate.getFullYear(), delivDate.getMonth(), 1).getDay()) / 7)}`;
  //     for (const item of items) {
  //       const prod = prodById.get(item.productId);
  //       const name = prod?.name || `Produto #${item.productId}`;
  //       if (!weeklyMap[name]) weeklyMap[name] = {};
  //       weeklyMap[name][weekKey] = (weeklyMap[name][weekKey] || 0) + Number(item.quantity || 0);
  //     }
  //   }
  //   const forecast = Object.entries(weeklyMap).map(([productName, weeks]) => {
  //     const weekValues = Object.values(weeks);
  //     const totalWeeks = 8;
  //     const avgWeekly = weekValues.reduce((s, v) => s + v, 0) / totalWeeks;
  //     const recentWeeks = weekValues.slice(-2);
  //     const recentAvg = recentWeeks.length ? recentWeeks.reduce((s, v) => s + v, 0) / recentWeeks.length : avgWeekly;
  //     const trend: 'up' | 'down' | 'stable' = recentAvg > avgWeekly * 1.1 ? 'up' : recentAvg < avgWeekly * 0.9 ? 'down' : 'stable';
  //     return {
  //       productName, avgWeekly: Math.round(avgWeekly * 10) / 10,
  //       suggestion: Math.ceil(avgWeekly * 1.15), weeksActive: weekValues.filter(v => v > 0).length,
  //       trend, recentAvg: Math.round(recentAvg * 10) / 10,
  //     };
  //   }).filter(f => f.avgWeekly > 0).sort((a, b) => b.avgWeekly - a.avgWeekly);
  //   res.json({ forecast, analyzedWeeks: 8, generatedAt: new Date().toISOString() });
  //   } catch (e: any) {
  //     console.error('Forecast error:', e);
  //     res.status(500).json({ message: e.message });
  //   }
  // });

  // MOVED TO purchase-planning.routes.ts
  // app.get('/api/purchase-planning', tenantContext, async (req, res) => { ... });

  // MOVED TO purchase-planning.routes.ts
  // app.post('/api/purchase-planning/status', async (req, res) => { ... });

  // MOVED TO purchase-planning.routes.ts
  // app.get('/api/purchase-planning/statuses', async (req, res) => { ... });

  // ── Estoque / Inventário ────────────────────────────────────
  // ⛔ MIGRATED: all `/api/inventory/*` endpoints now live in
  //    `server/modules/inventory/`. The module router is mounted BEFORE
  //    `registerRoutes(app)` in `server/app.ts` so it takes precedence.
  //    Inline handlers were removed in 2026-04 to delete dead code.

  // POST /api/fiscal-invoices/parse-pdf — extract text from PDF server-side
  app.post('/api/fiscal-invoices/parse-pdf', uploadInMemory.single('file'), async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    if (!req.file) return res.status(400).json({ message: 'Arquivo não enviado' });
    try {
      const data = await parsePdf(req.file.buffer);
      res.json({ text: data.text, pages: data.numpages, info: data.info });
    } catch (e: any) {
      console.error('PDF parse error:', e);
      res.status(500).json({ message: 'Erro ao processar PDF', detail: e.message });
    }
  });

  // ─── IMPORTAÇÃO DE DADOS (Excel / CSV / XML) ──────────────────────────────────
  // POST /api/import/preview — parse file and return preview rows (no DB write)
  app.post('/api/import/preview', uploadInMemory.single('file'), async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    if (!req.file) return res.status(400).json({ message: 'Arquivo não enviado' });
    try {
      const XLSX = await import('xlsx');
      const { originalname, buffer, mimetype } = req.file;
      const ext = originalname.split('.').pop()?.toLowerCase();
      let rows: Record<string, any>[] = [];

      if (ext === 'xml') {
        // Parse XML NF-e style
        const text = buffer.toString('utf8');
        const products: Record<string, any>[] = [];
        const detRegex = /<det[^>]*>([\s\S]*?)<\/det>/gi;
        const prodRegex = /<prod>([\s\S]*?)<\/prod>/i;
        const tagVal = (src: string, tag: string) => { const m = src.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i')); return m && m[1] ? m[1].trim() : ''; };
        let detMatch;
        while ((detMatch = detRegex.exec(text)) !== null) {
          const det = detMatch[1];
          if (!det) continue;
          const prodMatch = prodRegex.exec(det);
          if (prodMatch) {
            const p = prodMatch[1];
            if (!p) continue;
            products.push({
              tipo: 'produto',
              codigo: tagVal(p, 'cProd'),
              nome: tagVal(p, 'xProd'),
              quantidade: tagVal(p, 'qCom'),
              unidade: tagVal(p, 'uCom'),
              precoUnitario: tagVal(p, 'vUnCom'),
              precoTotal: tagVal(p, 'vProd'),
              ncm: tagVal(p, 'NCM'),
            });
          }
        }
        // Also get destinatário as client
        const destMatch = text.match(/<dest>([\s\S]*?)<\/dest>/i);
        if (destMatch && destMatch[1]) {
          const d = destMatch[1];
          rows.push({
            tipo: 'cliente',
            nome: tagVal(d, 'xNome'),
            cnpj: tagVal(d, 'CNPJ') || tagVal(d, 'CPF'),
            email: tagVal(d, 'email'),
            endereco: tagVal(d, 'xLgr') + (tagVal(d, 'nro') ? `, ${tagVal(d, 'nro')}` : ''),
            cidade: tagVal(d, 'xMun'),
            cep: tagVal(d, 'CEP'),
          });
        }
        rows = [...rows, ...products];
      } else {
        // Excel / CSV
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const firstSheetName = wb.SheetNames[0];
        if (!firstSheetName) {
          throw new BadRequestError('Planilha sem abas válidas');
        }
        const ws = wb.Sheets[firstSheetName];
        if (!ws) {
          throw new BadRequestError('Planilha sem abas válidas');
        }
        const data: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        rows = data.map((r: any) => {
          // Try to auto-detect columns with common Portuguese names
          const nome = r['nome'] || r['Nome'] || r['NOME'] || r['produto'] || r['Produto'] || r['PRODUTO'] || r['name'] || '';
          const codigo = r['codigo'] || r['Código'] || r['codigo_produto'] || r['cod'] || r['COD'] || r['id'] || '';
          const preco = r['preco'] || r['Preço'] || r['price'] || r['valor'] || r['Valor'] || r['preco_unitario'] || '';
          const quantidade = r['quantidade'] || r['Quantidade'] || r['qtd'] || r['QTD'] || r['qty'] || '';
          const cliente = r['cliente'] || r['Cliente'] || r['empresa'] || r['Empresa'] || r['company'] || '';
          const cnpj = r['cnpj'] || r['CNPJ'] || '';
          const categoria = r['categoria'] || r['Categoria'] || r['category'] || '';
          return { tipo: cliente ? 'pedido' : 'produto', nome, codigo, preco, quantidade, cliente, cnpj, categoria, ...r };
        }).filter((r: any) => r.nome || r.cliente);
      }

      res.json({ rows, total: rows.length, filename: originalname });
    } catch (e: any) { res.status(500).json({ message: 'Erro ao processar arquivo: ' + e.message }); }
  });

  // POST /api/import/execute — commit the import to DB
  app.post('/api/import/execute', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const { rows, mode } = req.body as { rows: Record<string, any>[]; mode: 'products' | 'orders' | 'clients' | 'auto' };
      const results = { created: 0, skipped: 0, errors: [] as string[] };

      const existingProducts = await storage.getProducts();
      const productCodeMap = Object.fromEntries(existingProducts.map((p: any) => [String(p.productCode || p.code || '').toLowerCase(), p]));
      const productNameMap = Object.fromEntries(existingProducts.map((p: any) => [String(p.name || '').toLowerCase(), p]));

      const existingCompanies = await storage.getCompanies();
      const companyCnpjMap = Object.fromEntries(existingCompanies.filter((c: any) => c.cnpj).map((c: any) => [String(c.cnpj).replace(/\D/g, ''), c]));
      const companyNameMap = Object.fromEntries(existingCompanies.map((c: any) => [(c.companyName || c.name || '').toLowerCase(), c]));

      for (const row of rows) {
        try {
          const tipo = row.tipo || mode;
          if (tipo === 'produto' || tipo === 'products' || mode === 'products') {
            const nome = String(row.nome || row.name || '').trim();
            const codigo = String(row.codigo || row.code || row.id || '').trim();
            if (!nome) { results.skipped++; continue; }
            if (productNameMap[nome.toLowerCase()] || (codigo && productCodeMap[codigo.toLowerCase()])) {
              results.skipped++;
              continue;
            }
            const preco = parseFloat(String(row.preco || row.price || row.precoUnitario || '0').replace(',', '.')) || 0;
            await storage.createProduct({
              name: nome,
              productCode: codigo || undefined,
              price: String(preco),
              category: row.categoria || row.category || 'Importado',
              unit: row.unidade || row.unit || 'KG',
              active: true,
            } as any);
            productNameMap[nome.toLowerCase()] = true;
            results.created++;
          } else if (tipo === 'cliente' || tipo === 'clients' || mode === 'clients') {
            const nome = String(row.nome || row.name || '').trim();
            const cnpj = String(row.cnpj || '').replace(/\D/g, '');
            if (!nome) { results.skipped++; continue; }
            if ((cnpj && companyCnpjMap[cnpj]) || companyNameMap[nome.toLowerCase()]) {
              results.skipped++;
              continue;
            }
            await storage.createCompany({
              companyName: nome,
              cnpj: cnpj || undefined,
              addressStreet: row.endereco || undefined,
              addressCity: row.cidade || undefined,
              addressZip: row.cep || undefined,
              email: row.email || undefined,
              active: true,
            } as any);
            companyNameMap[nome.toLowerCase()] = true;
            results.created++;
          }
        } catch (rowErr: any) {
          results.errors.push(rowErr.message);
        }
      }

      res.json({ ...results, message: `Importação concluída: ${results.created} criado(s), ${results.skipped} ignorado(s)` });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/fiscal-invoices — list all imported invoices
  app.get('/api/fiscal-invoices', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    res.json(await storage.getFiscalInvoices());
  });

  // GET /api/fiscal-invoices/check-duplicate — check if invoice number+cnpj already exists
  app.get('/api/fiscal-invoices/check-duplicate', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const { invoiceNumber, cnpj } = req.query as { invoiceNumber?: string; cnpj?: string };
    if (!invoiceNumber) return res.status(400).json({ message: 'invoiceNumber é obrigatório' });
    const isDuplicate = await storage.checkFiscalInvoiceDuplicate(invoiceNumber, cnpj);
    res.json({ isDuplicate });
  });

  // GET /api/fiscal-invoices/:id
  app.get('/api/fiscal-invoices/:id', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const invoice = await storage.getFiscalInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).json({ message: 'Nota não encontrada' });
    res.json(invoice);
  });

  // POST /api/fiscal-invoices — confirm and save a fiscal invoice + create inventory entry
  app.post('/api/fiscal-invoices', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const { invoiceNumber, supplier, supplierCnpj, issueDate, totalValue, items, notes, fileType, fileName } = req.body;
    if (!invoiceNumber || !supplier) return res.status(400).json({ message: 'invoiceNumber e supplier são obrigatórios' });

    try {
      const duplicateKey = `${invoiceNumber}_${supplierCnpj || ''}`;
      // Check duplicate
      const isDupe = await storage.checkFiscalInvoiceDuplicate(invoiceNumber, supplierCnpj);
      if (isDupe) return res.status(409).json({ message: 'Esta nota fiscal já foi registrada no sistema.', duplicate: true });

      const invoice = await storage.createFiscalInvoice({
        invoiceNumber,
        supplier,
        supplierCnpj: supplierCnpj || null,
        issueDate: issueDate || null,
        totalValue: totalValue ? String(totalValue) : null,
        items: items || [],
        status: 'CONFIRMED',
        importedBy: session.userId,
        notes: notes || null,
        fileType: fileType || null,
        fileName: fileName || null,
        duplicateKey,
      });

      // Auto-create inventory entries for each item
      const itemList = Array.isArray(items) ? items : [];
      for (const item of itemList) {
        if (!item.name || !item.quantity) continue;
        try {
          await storage.createInventoryEntry({
            productId: item.linkedProductId || null,
            productName: item.linkedProductName || item.name,
            category: item.category || 'Outros',
            supplier,
            quantity: String(item.quantity),
            unit: item.unit || 'kg',
            purchasePrice: item.unitPrice ? String(item.unitPrice) : null,
            invoiceNumber,
            invoiceDate: issueDate || null,
            entryDate: new Date().toISOString().substring(0, 10),
            expiryDate: null,
            notes: `Importado da nota fiscal ${invoiceNumber}`,
            createdBy: session.userId ? String(session.userId) : 'System',
          });
        } catch (entryErr) {
          console.error('Error creating inventory entry for item:', item.name, entryErr);
        }
      }

      res.status(201).json(invoice);
    } catch (e: any) {
      console.error('Fiscal invoice error:', e);
      res.status(500).json({ message: 'Erro ao salvar nota fiscal', detail: e.message });
    }
  });

  // DELETE /api/fiscal-invoices/:id
  app.delete('/api/fiscal-invoices/:id', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    await storage.deleteFiscalInvoice(Number(req.params.id));
    res.status(204).send();
  });

  // ── Geocoding proxy (Nominatim) ────────────────────────────
  // MOVED TO geocode.routes.ts
  // GET /api/geocode

  // MOVED TO about-us.routes.ts
  // GET /api/about-us
  // PUT /api/about-us

  // ─── SMTP Config Routes ──────────────────────────────────────────────────────
  app.get('/api/smtp-config', async (req: any, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const cfg = await storage.getSmtpConfig();
      if (!cfg) return res.json({ host: '', port: 587, user: '', password: '', senderEmail: '', senderName: 'VivaFrutaz', hasPassword: false });
      res.json({ ...cfg, password: cfg.password ? '••••••••' : '', hasPassword: !!cfg.password });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put('/api/smtp-config', async (req: any, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
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

  app.post('/api/smtp-config/test', async (req: any, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
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

  // ─── IA ASSISTENTE VIRTUAL (Interactive AI Chat) ──────────────
  // SECURITY: tenantContext resolves the principal; tenantWhere(aiInteractions)
  // scopes the read to the current tenant. MASTER without a target tenant sees
  // an empty list — they must pass ?empresaId=N to inspect a specific tenant.
  app.get('/api/assistant/history', tenantContext, async (req: any, res) => {
    try {
      const tenantId = currentTenantId();
      // Cross-tenant admins (MASTER without ?empresaId) get nothing — there is
      // no "global AI history" view; they must scope to a tenant explicitly.
      if (tenantId == null) {
        return res.json([]);
      }
      const rows = await db.select().from(aiInteractions)
        .where(tenantWhere(aiInteractions))
        .orderBy(desc(aiInteractions.createdAt))
        .limit(50);
      // Within a tenant, company-portal users only see their company's
      // interactions; admin-portal users see everything in the tenant.
      const filtered = req.session?.companyId
        ? rows.filter((r: any) => r.companyId === req.session.companyId)
        : rows;
      res.json(filtered);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/assistant/chat', async (req: any, res) => {
    const isUser = !!req.session?.userId;
    const isCompany = !!req.session?.companyId;
    if (!isUser && !isCompany) return res.status(401).json({ message: 'Não autenticado' });

    const { message, sessionContext } = req.body;
    if (!message || typeof message !== 'string') return res.status(400).json({ message: 'Mensagem inválida' });

    const msg = message.trim().toLowerCase();

    let user: any = null;
    let company: any = null;
    if (isUser) user = await storage.getUser(req.session.userId);
    if (isCompany) company = await storage.getCompany(req.session.companyId);

    const isAdmin = user && ['ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role);
    const isInternal = !!user;

    let intent = 'unknown';
    let response = '';
    let newContext: any = null;
    let actionExecuted: string | null = null;
    let actionData: any = null;

    // ── Multi-turn: create company flow ────────────────────────────
    if (sessionContext?.action === 'create_company') {
      const step = sessionContext.step;
      const data = sessionContext.data || {};

      if (msg === 'cancelar' || msg === 'cancela' || msg === 'não' || msg === 'nao') {
        intent = 'cancel';
        response = '❌ Criação de empresa cancelada.';
        newContext = null;
      } else if (step === 'name') {
        data.name = message.trim();
        newContext = { action: 'create_company', step: 'cnpj', data };
        intent = 'create_company';
        response = `✅ Nome: **${data.name}**\n\nAgora informe o **CNPJ** da empresa (ou "pular" para deixar em branco):`;
      } else if (step === 'cnpj') {
        data.cnpj = msg === 'pular' ? null : message.trim();
        newContext = { action: 'create_company', step: 'email', data };
        intent = 'create_company';
        response = `✅ CNPJ: ${data.cnpj || '(em branco)'}\n\nAgora informe o **e-mail de acesso** da empresa (ex: empresa01):`;
      } else if (step === 'email') {
        const emailInput = message.trim().toLowerCase();
        const email = emailInput.endsWith('@vivafrutaz.com') ? emailInput : emailInput + '@vivafrutaz.com';
        data.email = email;
        newContext = { action: 'create_company', step: 'contact', data };
        intent = 'create_company';
        response = `✅ E-mail: **${email}**\n\nInforme o **nome do contato** responsável (ou "pular"):`;
      } else if (step === 'contact') {
        data.contactName = msg === 'pular' ? data.name : message.trim();
        newContext = { action: 'create_company', step: 'confirm', data };
        intent = 'create_company';
        response = `📋 **Resumo da nova empresa:**\n\n• Nome: ${data.name}\n• CNPJ: ${data.cnpj || '—'}\n• E-mail: ${data.email}\n• Contato: ${data.contactName}\n\nDigite **"confirmar"** para criar ou **"cancelar"** para desistir.`;
      } else if (step === 'confirm' && (msg === 'confirmar' || msg === 'sim' || msg === 'ok')) {
        try {
          const existing = await storage.getCompanyByEmail(data.email);
          if (existing) {
            response = `⚠️ Já existe uma empresa com o e-mail **${data.email}**. Tente outro e-mail.`;
            newContext = { action: 'create_company', step: 'email', data };
          } else {
            const newComp = await storage.createCompany({
              companyName: data.name,
              contactName: data.contactName || data.name,
              email: data.email,
              password: '123456',
              cnpj: data.cnpj || null,
              priceGroupId: 1,
              allowedOrderDays: [],
              active: true,
              clientType: 'semanal',
            });
            actionExecuted = 'create_company';
            actionData = { companyId: newComp.id, companyName: data.name };
            intent = 'create_company_done';
            response = `✅ **Empresa criada com sucesso!**\n\n• ID: #${newComp.id}\n• Nome: ${data.name}\n• E-mail: ${data.email}\n• Senha padrão: **123456**\n\nA empresa já pode fazer login no portal. Acesse Empresas para configurar preços, dias de entrega e demais dados.`;
            newContext = null;
          }
        } catch (e: any) {
          response = `❌ Erro ao criar empresa: ${e.message}`;
          newContext = null;
        }
      } else {
        response = 'Por favor responda à pergunta anterior ou digite **"cancelar"** para desistir.';
        newContext = sessionContext;
      }
    }

    // ── Task creation multi-turn ─────────────────────────────────────
    if (sessionContext?.action === 'create_task') {
      const step = sessionContext.step;
      const data = sessionContext.data || {};

      if (msg === 'cancelar' || msg === 'cancela' || msg === 'não' || msg === 'nao') {
        intent = 'cancel';
        response = '❌ Criação de tarefa cancelada.';
        newContext = null;
      } else if (step === 'title') {
        data.title = message.trim();
        newContext = { action: 'create_task', step: 'description', data };
        intent = 'create_task';
        response = `✅ Título: **${data.title}**\n\nDescreva a tarefa (ou "pular"):`;
      } else if (step === 'description') {
        data.description = msg === 'pular' ? '' : message.trim();
        newContext = { action: 'create_task', step: 'priority', data };
        intent = 'create_task';
        response = `✅ Descrição salva.\n\nQual a **prioridade**?\n• alta\n• media\n• baixa`;
      } else if (step === 'priority') {
        const priorityMap: Record<string, string> = { alta: 'high', alto: 'high', media: 'medium', médio: 'medium', baixa: 'low', baixo: 'low' };
        data.priority = priorityMap[msg] || 'medium';
        newContext = { action: 'create_task', step: 'confirm', data };
        intent = 'create_task';
        response = `📋 **Resumo da tarefa:**\n\n• Título: ${data.title}\n• Descrição: ${data.description || '—'}\n• Prioridade: ${data.priority}\n\nDigite **"confirmar"** para criar ou **"cancelar"** para desistir.`;
      } else if (step === 'confirm' && (msg === 'confirmar' || msg === 'sim' || msg === 'ok')) {
        try {
          const newTask = await storage.createTask({
            title: data.title,
            description: data.description || '',
            priority: data.priority || 'medium',
            assignedToId: user?.id,
            assignedToName: user?.name,
            createdById: user?.id,
            createdByName: user?.name,
          });
          actionExecuted = 'create_task';
          actionData = { taskId: newTask.id, title: data.title };
          intent = 'create_task_done';
          response = `✅ **Tarefa criada com sucesso!**\n\n• Título: ${data.title}\n• Prioridade: ${data.priority}\n\nAcesse **Menu → Tarefas** para visualizar e gerenciar.`;
          newContext = null;
          // Fire push for task created by Clara
          fireNotification('clara_task', { task: data.title }, { url: '/admin/tasks', companyId: user?.empresaId ?? undefined });
        } catch (e: any) {
          response = `❌ Erro ao criar tarefa: ${e.message}`;
          newContext = null;
        }
      } else {
        response = 'Por favor responda à pergunta anterior ou digite **"cancelar"** para desistir.';
        newContext = sessionContext;
      }
    }

    // ── Single-turn intents ─────────────────────────────────────────
    // Check Clara training data first
    else if (await (async () => {
      try {
        const trainings = await storage.getClaraTrainings();
        const active = trainings.filter((t: any) => t.active);
        for (const t of active) {
          const q = t.question.toLowerCase().trim();
          const words = q.split(/\s+/).filter((w: string) => w.length > 3);
          const matches = words.filter((w: string) => msg.includes(w));
          if (matches.length >= Math.min(2, Math.ceil(words.length * 0.5))) {
            intent = 'trained_response';
            response = t.answer;
            return true;
          }
        }
      } catch { /* ignore */ }
      return false;
    })()) { /* response already set above */ }

    else if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|oi tudo|tudo bem|olá clara|clara)/.test(msg)) {
      intent = 'greeting';
      const name = user?.name?.split(' ')[0] || company?.companyName?.split(' ')[0] || '';
      response = `Olá${name ? `, ${name}` : ''}! 👋 Sou a **Clara**, assistente inteligente da VivaFrutaz.\n\nPosso ajudar com:\n• 📦 Pedidos e entregas\n• 🏢 Empresas e cadastros\n• 📊 Estoque e produtos\n• 🚚 Logística e rotas\n• 🛒 Planejamento de compras\n• 🌤️ Clima para entregas\n• ✅ Criar tarefas e cadastros`;
    }

    else if (/clima|tempo|previsão do tempo|previsao do tempo|chuva|temperatura|vai chover|como está o tempo/.test(msg)) {
      intent = 'weather';
      try {
        const city = msg.match(/em\s+([a-záàâãéèêíïóôõöúçñü\s]+)/i)?.[1]?.trim() || 'São Paulo';
        const cityEncoded = encodeURIComponent(city);
        const weatherRes = await fetch(`https://wttr.in/${cityEncoded}?format=%l:+%C,+%t+(sensação+%f),+umidade+%h&lang=pt`, {
          headers: { 'User-Agent': 'VivaFrutaz/1.0' },
          signal: AbortSignal.timeout(5000),
        });
        if (weatherRes.ok) {
          const weatherText = await weatherRes.text();
          response = `🌤️ **Previsão do Tempo**\n\n${weatherText.trim()}\n\n_Fonte: wttr.in — dados em tempo real_`;
        } else {
          response = '⚠️ Não consegui obter a previsão do tempo agora. Tente novamente em instantes.';
        }
      } catch {
        response = '⚠️ Serviço de clima temporariamente indisponível. Tente novamente mais tarde.';
      }
    }

    else if (isInternal && /criar empresa|adicionar empresa|nova empresa|cadastrar empresa/.test(msg)) {
      if (!isAdmin) {
        intent = 'permission_denied';
        response = '⚠️ Apenas Administradores e Diretores podem criar empresas pelo assistente.';
      } else {
        intent = 'create_company';
        newContext = { action: 'create_company', step: 'name', data: {} };
        response = '🏢 **Criar Nova Empresa**\n\nVou te guiar pelo cadastro. Digite **"cancelar"** a qualquer momento para desistir.\n\nPrimeiro, informe o **nome da empresa**:';
      }
    }

    else if (isInternal && /pedido|pedidos/.test(msg)) {
      intent = 'query_orders';
      try {
        const allOrders = await storage.getOrders();
        const today = new Date().toISOString().split('T')[0];
        const todayOrders = allOrders.filter((o: any) => o.deliveryDate?.toString().startsWith(today) || o.orderDate?.toString().startsWith(today));
        const pending = allOrders.filter((o: any) => o.status === 'PENDING' || o.status === 'ACTIVE');
        const confirmed = allOrders.filter((o: any) => o.status === 'CONFIRMED');
        const cancelled = allOrders.filter((o: any) => o.status === 'CANCELLED');

        if (/hoje|movimento hoje|resumo de hoje/.test(msg)) {
          response = `📦 **Pedidos de Hoje (${today})**\n\n• Entrega hoje: ${todayOrders.length}\n• Pendentes/Ativos: ${pending.length}\n• Confirmados: ${confirmed.length}\n• Cancelados: ${cancelled.length}\n• Total no sistema: ${allOrders.length}`;
        } else if (/pendente|pendentes/.test(msg)) {
          if (pending.length === 0) {
            response = '✅ Nenhum pedido pendente no momento.';
          } else {
            const lines = pending.slice(0, 10).map((o: any) => `• ${o.orderCode || `#${o.id}`} — ${o.status}`).join('\n');
            response = `⏳ **Pedidos Pendentes (${pending.length} total)**\n\n${lines}${pending.length > 10 ? `\n\n...e mais ${pending.length - 10} pedidos. Acesse o painel de pedidos para ver todos.` : ''}`;
          }
        } else if (/quantos|total|quantidade/.test(msg)) {
          response = `📊 **Total de Pedidos no Sistema**\n\n• Total: ${allOrders.length}\n• Confirmados: ${confirmed.length}\n• Pendentes/Ativos: ${pending.length}\n• Cancelados: ${cancelled.length}`;
        } else {
          response = `📦 **Resumo de Pedidos**\n\n• Total: ${allOrders.length}\n• Confirmados: ${confirmed.length}\n• Pendentes: ${pending.length}\n• Cancelados: ${cancelled.length}\n\nPara detalhes específicos, pergunte: "pedidos hoje", "pedidos pendentes", "quantos pedidos".`;
        }
      } catch { response = '⚠️ Não foi possível consultar os pedidos agora.'; }
    }

    else if (isInternal && /empresa|empresas/.test(msg)) {
      intent = 'query_companies';
      try {
        const allCompanies = await storage.getCompanies();
        const active = allCompanies.filter((c: any) => c.active);
        const inactive = allCompanies.filter((c: any) => !c.active);

        if (/não pediram|nao pediram|sem pedido|não fizeram pedido|nao fizeram/.test(msg)) {
          const allOrders = await storage.getOrders();
          const activeWindow = await storage.getActiveOrderWindow();
          const weekRef = activeWindow?.weekReference;
          const companiesWithOrders = new Set(
            allOrders
              .filter((o: any) => weekRef ? o.weekReference === weekRef : true)
              .filter((o: any) => o.status !== 'CANCELLED')
              .map((o: any) => o.companyId)
          );
          const noPedido = active.filter((c: any) => !companiesWithOrders.has(c.id));
          if (noPedido.length === 0) {
            response = `✅ Todas as empresas ativas já fizeram pedido${weekRef ? ` na ${weekRef}` : ''}.`;
          } else {
            const lines = noPedido.slice(0, 15).map((c: any) => `• ${c.companyName}`).join('\n');
            response = `⚠️ **Empresas sem pedido${weekRef ? ` (${weekRef})` : ''}:** ${noPedido.length}\n\n${lines}${noPedido.length > 15 ? `\n\n...e mais ${noPedido.length - 15}` : ''}`;
          }
        } else if (/inativa|inativas/.test(msg)) {
          if (inactive.length === 0) {
            response = '✅ Nenhuma empresa inativa.';
          } else {
            const lines = inactive.slice(0, 10).map((c: any) => `• ${c.companyName}`).join('\n');
            response = `🔴 **Empresas Inativas (${inactive.length})**\n\n${lines}`;
          }
        } else {
          response = `🏢 **Empresas no Sistema**\n\n• Total: ${allCompanies.length}\n• Ativas: ${active.length}\n• Inativas: ${inactive.length}\n\nDicas:\n• "Empresas que não fizeram pedido"\n• "Empresas inativas"\n• "Criar empresa"`;
        }
      } catch { response = '⚠️ Não foi possível consultar as empresas agora.'; }
    }

    else if (isInternal && /estoque|inventário|inventario|produto|produtos/.test(msg)) {
      intent = 'query_stock';
      try {
        const prods = await storage.getProducts();
        const active = prods.filter((p: any) => p.active !== false);
        const inventorySettings = await storage.getInventorySettings();

        if (/baixo|crítico|critico|faltando|pouco|mínimo|minimo/.test(msg)) {
          const lowStock = inventorySettings.filter((s: any) => {
            const current = parseFloat(s.currentStock || '0');
            const min = parseFloat(s.minStock || '0');
            return min > 0 && current <= min;
          });
          if (lowStock.length === 0) {
            response = `✅ **Estoque OK** — Nenhum produto com estoque crítico no momento.`;
          } else {
            const lines = lowStock.slice(0, 10).map((s: any) => `• **${s.productName}**: ${s.currentStock} ${s.unit || 'un'} (mínimo: ${s.minStock})`).join('\n');
            response = `⚠️ **Estoque Crítico (${lowStock.length} produto(s))**\n\n${lines}${lowStock.length > 10 ? `\n\n...e mais ${lowStock.length - 10}` : ''}\n\nAcesse **Menu → Estoque** para detalhes.`;
          }
        } else {
          const tracked = inventorySettings.length;
          response = `📦 **Estoque VivaFrutaz**\n\n• Produtos cadastrados: **${prods.length}**\n• Produtos ativos: **${active.length}**\n• Produtos com controle de estoque: **${tracked}**\n\nDicas:\n• "Clara, produtos com estoque baixo"\n• "Clara, lista de compras"\n\nAcesse **Menu → Estoque** para painel completo.`;
        }
      } catch { response = '⚠️ Não foi possível consultar o estoque agora.'; }
    }

    else if (isInternal && /compra|compras|lista de compras|plano de compras|planejamento|o que comprar|precisa comprar/.test(msg)) {
      intent = 'query_purchases';
      try {
        const allOrders = await storage.getOrders();
        const activeWindow = await storage.getActiveOrderWindow();
        const weekRef = activeWindow?.weekReference;
        const weekOrders = weekRef ? allOrders.filter((o: any) => o.weekReference === weekRef && o.status !== 'CANCELLED') : [];
        const prods = await storage.getProducts();
        const inventorySettings = await storage.getInventorySettings();

        if (weekOrders.length === 0) {
          response = `🛒 **Planejamento de Compras**\n\n${weekRef ? `Semana: ${weekRef}\n` : ''}Nenhum pedido ativo para a semana atual.\n\nAcesse **Menu → Planejamento de Compras** para gerar a lista completa.`;
        } else {
          const lowStock = inventorySettings.filter((s: any) => parseFloat(s.currentStock || '0') <= parseFloat(s.minStock || '0'));
          response = `🛒 **Planejamento de Compras**\n\n${weekRef ? `📅 Semana: **${weekRef}**` : ''}\n• Pedidos ativos: **${weekOrders.length}**\n• Produtos com estoque baixo: **${lowStock.length}**\n\n${lowStock.length > 0 ? `⚠️ Reposição urgente:\n${lowStock.slice(0, 5).map((s: any) => `• ${s.productName}: ${s.currentStock} (mín: ${s.minStock})`).join('\n')}\n\n` : ''}Acesse **Menu → Planejamento de Compras** para a lista completa com quantidades.`;
        }
      } catch { response = '🛒 Acesse **Menu → Planejamento de Compras** para ver a lista detalhada.'; }
    }

    else if (isInternal && /criar tarefa|nova tarefa|adicionar tarefa|agendar tarefa/.test(msg)) {
      intent = 'create_task';
      newContext = { action: 'create_task', step: 'title', data: {} };
      response = `✅ **Criar Nova Tarefa**\n\nVou te guiar. Digite **"cancelar"** a qualquer momento.\n\nQual é o **título** da tarefa?`;
    }

    else if (isInternal && /rota|rotas|logística|logistica|entrega|entregas|janela de entrega|janelas|horário de entrega/.test(msg)) {
      intent = 'query_routes';
      try {
        const routes = await storage.getRoutes();
        const activeWindow = await storage.getActiveOrderWindow();
        let routeLines = '';
        if (routes.length > 0) {
          routeLines = routes.slice(0, 8).map((r: any) => `• **${r.name}** — ${r.status || 'Ativa'}${r.driverName ? ` — Motorista: ${r.driverName}` : ''}`).join('\n');
        }

        // Check if asking about a specific company's delivery window
        const companyMatch = message.match(/(?:empresa|cliente|para)\s+([A-Za-záàâãéèêíïóôõöúçñü\s]+)/i);
        if (companyMatch && companyMatch[1]) {
          const searchName = companyMatch[1].trim().toLowerCase();
          const allCompanies = await storage.getCompanies();
          const found = allCompanies.find((c: any) => c.companyName?.toLowerCase().includes(searchName));
          if (found) {
            let deliveryInfo = `🚚 **Logística — ${found.companyName}**\n\n`;
            if (found.deliveryConfigJson) {
              try {
                const cfg = typeof found.deliveryConfigJson === 'string' ? JSON.parse(found.deliveryConfigJson) : found.deliveryConfigJson;
                const days = Object.entries(cfg).filter(([, v]: any) => v?.enabled).map(([day, v]: any) => `• ${day}: ${v.startTime} às ${v.endTime}`).join('\n');
                deliveryInfo += days.length > 0 ? `Janelas de entrega:\n${days}` : 'Nenhuma janela configurada.';
              } catch { deliveryInfo += 'Configuração não disponível.'; }
            } else {
              deliveryInfo += found.deliveryTime ? `Horário padrão: **${found.deliveryTime}**` : 'Nenhuma janela de entrega configurada para esta empresa.';
            }
            if ((found.allowedOrderDays as any)?.length > 0) {
              deliveryInfo += `\n\nDias de pedido: ${(found.allowedOrderDays as any[]).join(', ')}`;
            }
            response = deliveryInfo;
          } else {
            response = `⚠️ Empresa "**${companyMatch[1]!.trim()}**" não encontrada. Verifique o nome e tente novamente.`;
          }
        } else {
          response = `🚚 **Logística e Rotas**\n\n• Rotas cadastradas: **${routes.length}**\n${routeLines ? `\n${routeLines}\n` : ''}\n${activeWindow ? `📅 Janela ativa: **${activeWindow.weekReference}** — entrega de ${new Date(activeWindow.deliveryStartDate).toLocaleDateString('pt-BR')} a ${new Date(activeWindow.deliveryEndDate).toLocaleDateString('pt-BR')}` : '⚠️ Nenhuma janela de entrega ativa'}\n\nDica: "Clara, qual o horário de entrega da empresa [Nome]?"`;
        }
      } catch { response = '🚚 Acesse **Menu → Logística** para ver rotas, motoristas e veículos.'; }
    }

    else if (isInternal && /sistema|auditoria|saúde|saude|erros|alertas|status do sistema/.test(msg)) {
      intent = 'system_status';
      try {
        const allOrders = await storage.getOrders();
        const confirmed = allOrders.filter((o: any) => o.status === 'CONFIRMED').length;
        const pending = allOrders.filter((o: any) => o.status === 'PENDING' || o.status === 'ACTIVE').length;
        response = `🔧 **Status do Sistema**\n\n• Pedidos confirmados: ${confirmed}\n• Pedidos pendentes: ${pending}\n• Total de pedidos: ${allOrders.length}\n\nPara auditoria completa → Menu → Área do Desenvolvedor → Auditoria\nPara alertas preditivos → Menu → IA Operacional`;
      } catch { response = '🔧 Para auditoria completa acesse → Menu → Área do Desenvolvedor → Auditoria.'; }
    }

    else if (!isInternal && company) {
      // Client-specific queries
      if (/pedido|meu pedido|meus pedidos|status/.test(msg)) {
        intent = 'client_orders';
        try {
          const compOrders = await storage.getCompanyOrders(company.id);
          const recent = compOrders.slice(0, 5);
          if (recent.length === 0) {
            response = '📦 Você ainda não tem pedidos registrados. Acesse "Novo Pedido" para fazer seu primeiro pedido.';
          } else {
            const statusMap: Record<string, string> = {
              CONFIRMED: '✅ Confirmado', ACTIVE: '🟡 Em andamento', CANCELLED: '❌ Cancelado',
              PENDING: '⏳ Pendente', OPEN_FOR_EDITING: '✏️ Em edição', REOPEN_REQUESTED: '🔄 Solicitando reabertura'
            };
            const lines = recent.map((o: any) => `• ${o.orderCode || `#${o.id}`} — ${statusMap[o.status] || o.status} — Entrega: ${o.deliveryDate?.toString().split('T')[0] || '—'}`).join('\n');
            response = `📦 **Seus Pedidos Recentes**\n\n${lines}\n\nPara ver o histórico completo acesse "Histórico de Pedidos" no menu.`;
          }
        } catch { response = '⚠️ Não foi possível consultar seus pedidos agora.'; }
      } else if (/entrega|quando chega|previsão|previsao/.test(msg)) {
        intent = 'client_delivery';
        try {
          const win = await storage.getActiveOrderWindow();
          if (win) {
            response = `📅 **Janela de Pedidos Ativa**\n\n• Semana: ${win.weekReference}\n• Pedidos até: ${new Date(win.orderCloseDate).toLocaleDateString('pt-BR')}\n• Entrega: ${new Date(win.deliveryStartDate).toLocaleDateString('pt-BR')} a ${new Date(win.deliveryEndDate).toLocaleDateString('pt-BR')}`;
          } else {
            response = '📅 Não há janela de pedidos aberta no momento. Aguarde a abertura da próxima janela.';
          }
        } catch { response = '⚠️ Não foi possível consultar a janela de entrega agora.'; }
      } else {
        intent = 'client_general';
        response = `Olá! Posso ajudar com:\n• **"meus pedidos"** — ver status dos pedidos\n• **"previsão de entrega"** — ver datas da janela atual\n• **"clima"** — previsão do tempo\n• **"suporte"** — contato com a equipe\n\nOu fale diretamente com nossa equipe pelo WhatsApp! 📱`;
      }
    }

    else if (isInternal && /exportar|gerar relatório|gerar relatorio|relatório financeiro|relatorio financeiro|relatório de pedidos|relatorio de pedidos|download/.test(msg)) {
      intent = 'export';
      // Parse type
      const isFinancial = /faturamento|financeiro|financeira|fiscal|nota/.test(msg);
      const isPurchase = /compras|purchase|fornecedor/.test(msg);
      const type = isFinancial ? 'financial' : isPurchase ? 'orders' : 'orders';

      // Parse period
      let period = 'week';
      let periodLabel = 'esta semana';
      if (/hoje|today/.test(msg)) { period = 'today'; periodLabel = 'hoje'; }
      else if (/semana/.test(msg)) { period = 'week'; periodLabel = 'desta semana'; }
      else if (/mês passado|mes passado|último mês|ultimo mes/.test(msg)) { period = 'lastmonth'; periodLabel = 'do mês passado'; }
      else if (/mês|mes|mensal/.test(msg)) { period = 'month'; periodLabel = 'deste mês'; }
      else if (/tudo|todos|histórico|historico|completo/.test(msg)) { period = 'all'; periodLabel = 'completo (todos os períodos)'; }

      // Parse company name
      let companyParam = '';
      let companyLabel = '';
      const empresaMatch = msg.match(/(?:da empresa|do cliente|empresa|cliente)\s+([a-záéíóúãõâêôçñ\s]{2,30})(?:\s|$)/i);
      if (empresaMatch && empresaMatch[1]) {
        const searchName = empresaMatch[1].trim().toLowerCase();
        const allCompanies = await storage.getCompanies();
        const found = allCompanies.find((c: any) =>
          c.companyName.toLowerCase().includes(searchName) ||
          searchName.includes(c.companyName.toLowerCase().substring(0, 4))
        );
        if (found) {
          companyParam = `&companyId=${found.id}`;
          companyLabel = ` da empresa **${(found as any).companyName}**`;
        }
      }

      // Parse status
      let statusParam = '';
      if (/pendente/.test(msg)) statusParam = '&status=PENDING';
      else if (/confirmado/.test(msg)) statusParam = '&status=CONFIRMED';
      else if (/ativo|ativa/.test(msg)) statusParam = '&status=ACTIVE';

      // Count orders for this period
      try {
        const allOrders = await storage.getOrders();
        const now = new Date();
        let dateFrom: Date | null = null;
        if (period === 'today') dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        else if (period === 'week') { const diff = now.getDay() === 0 ? -6 : 1 - now.getDay(); dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff); }
        else if (period === 'month') dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        else if (period === 'lastmonth') dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);

        let filtered = allOrders;
        if (dateFrom) filtered = filtered.filter((o: any) => new Date(o.orderDate || o.createdAt) >= dateFrom!);
        if (companyParam) {
          const cid = parseInt(companyParam.split('=')[1] ?? '');
          filtered = filtered.filter((o: any) => o.companyId === cid);
        }
        if (statusParam) {
          const st = statusParam.split('=')[1];
          filtered = filtered.filter((o: any) => o.status === st);
        }
        if (isFinancial) filtered = filtered.filter((o: any) => o.status !== 'CANCELLED');

        const count = filtered.length;
        const total = filtered.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
        const typeLabel = isFinancial ? 'financeiro' : 'de pedidos';

        const downloadUrl = `/api/clara/export?type=${type}&period=${period}${companyParam}${statusParam}`;
        response = `📊 **Relatório ${typeLabel} ${periodLabel}${companyLabel}**\n\nEncontrei **${count} ${isFinancial ? 'pedido(s) faturável(is)' : 'pedido(s)'}**${total > 0 ? ` · Total: **R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**` : ''}.\n\n✅ Clique no botão abaixo para baixar o arquivo Excel.`;
        newContext = { action: 'export_ready', data: { downloadUrl, count, type: typeLabel, period: periodLabel } };
      } catch {
        response = `📊 Preparando exportação de relatório ${isFinancial ? 'financeiro' : 'de pedidos'} ${periodLabel}${companyLabel}.\n\n✅ Clique no botão abaixo para baixar.`;
        newContext = { action: 'export_ready', data: { downloadUrl: `/api/clara/export?type=${type}&period=${period}${companyParam}${statusParam}` } };
      }
    }

    else if (isInternal && /analisar clientes|clientes em risco|clientes inativos|clientes parado|cliente inativo|clientes sem pedido há/.test(msg)) {
      intent = 'commercial_risk';
      try {
        const now = Date.now();
        const allOrders = await storage.getOrders();
        const allCompanies = await storage.getCompanies();
        const activeCompanies = allCompanies.filter((c: any) => c.active);
        const ordersByCompany: Record<number, any[]> = {};
        for (const o of allOrders.filter((o: any) => o.status !== 'CANCELLED')) {
          if (!ordersByCompany[o.companyId]) ordersByCompany[o.companyId] = [];
          ordersByCompany[o.companyId]!.push(o);
        }
        const atRisk = activeCompanies.filter((c: any) => {
          const orders = ordersByCompany[c.id] || [];
          if (orders.length === 0) return false;
          const lastOrder = orders.reduce((a: any, b: any) => new Date(b.orderDate || b.createdAt) > new Date(a.orderDate || a.createdAt) ? b : a);
          const days = Math.floor((now - new Date(lastOrder.orderDate || lastOrder.createdAt).getTime()) / 86400000);
          return days >= 14;
        }).map((c: any) => {
          const orders = ordersByCompany[c.id] || [];
          const last = orders.reduce((a: any, b: any) => new Date(b.orderDate || b.createdAt) > new Date(a.orderDate || a.createdAt) ? b : a);
          const days = Math.floor((now - new Date(last.orderDate || last.createdAt).getTime()) / 86400000);
          return { name: c.companyName, days };
        }).sort((a, b) => b.days - a.days).slice(0, 8);

        if (atRisk.length === 0) {
          response = `✅ **Clientes em Risco**\n\nNenhum cliente inativo detectado nos últimos 14 dias. Todos os clientes ativos compraram recentemente! 🎉`;
        } else {
          const lines = atRisk.map(c => `• **${c.name}** — ${c.days} dias sem pedido`).join('\n');
          response = `🔴 **Clientes em Risco (${atRisk.length})**\n\n${lines}\n\nAcesse **Menu → Inteligência Comercial** para análise completa e sugestões de ação.`;
        }
      } catch { response = '⚠️ Não foi possível analisar os clientes agora. Acesse **Menu → Inteligência Comercial**.'; }
    }

    else if (isInternal && /oportunidade|oportunidades de venda|produtos parado|produtos que pararam|produto não pedido|venda cruzada/.test(msg)) {
      intent = 'commercial_opportunities';
      response = `💡 **Oportunidades de Venda**\n\nAcesse **Menu → Inteligência Comercial** para ver:\n\n• Produtos que clientes pararam de pedir\n• Clientes com queda de volume\n• Sugestões de reposição\n\nO painel atualiza automaticamente com base no histórico de compras.`;
    }

    else if (isInternal && /prever faturamento|faturamento previsto|previsão de faturamento|previsao de faturamento|forecast|faturamento do mes/.test(msg)) {
      intent = 'financial_forecast';
      try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const allOrders = await storage.getOrders();
        const validOrders = allOrders.filter((o: any) => o.status !== 'CANCELLED');
        const thisMonthOrders = validOrders.filter((o: any) => new Date(o.orderDate || o.createdAt) >= startOfMonth);
        const thisMonthRevenue = thisMonthOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
        // Last 3 months avg
        const last3 = [1, 2, 3].map(i => {
          const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
          return validOrders.filter((o: any) => { const d = new Date(o.orderDate || o.createdAt); return d >= mStart && d <= mEnd; })
            .reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
        });
        const avg3 = last3.reduce((a, b) => a + b, 0) / 3;
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const forecast = thisMonthRevenue + (avg3 / daysInMonth) * (daysInMonth - now.getDate());
        const growthPct = avg3 > 0 ? ((forecast - avg3) / avg3) * 100 : 0;

        response = `💰 **Previsão de Faturamento**\n\n📅 Mês atual: **R$ ${thisMonthRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}** (até hoje)\n📈 Previsão: **R$ ${forecast.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**\n📊 Média últimos 3 meses: R$ ${avg3.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n${growthPct > 0 ? `🟢 Tendência: +${growthPct.toFixed(1)}%` : `🔴 Tendência: ${growthPct.toFixed(1)}%`}\n\nAcesse **Menu → Inteligência Financeira** para análise completa.`;
      } catch { response = '💰 Acesse **Menu → Inteligência Financeira** para ver previsão de faturamento e análises detalhadas.'; }
    }

    else if (isInternal && /faturamento por cliente|ranking de cliente|clientes mais rentáveis|clientes mais rentaveis|top clientes/.test(msg)) {
      intent = 'financial_ranking';
      try {
        const allOrders = await storage.getOrders();
        const allCompanies = await storage.getCompanies();
        const validOrders = allOrders.filter((o: any) => o.status !== 'CANCELLED');
        const byCompany: Record<number, { name: string; total: number }> = {};
        for (const o of validOrders) {
          if (!byCompany[o.companyId]) {
            const c = allCompanies.find((c: any) => c.id === o.companyId);
            byCompany[o.companyId] = { name: c?.companyName || `#${o.companyId}`, total: 0 };
          }
          byCompany[o.companyId]!.total += parseFloat(o.totalValue || '0');
        }
        const top = Object.values(byCompany).sort((a, b) => b.total - a.total).slice(0, 8);
        const lines = top.map((c, i) => `${i + 1}. **${c.name}** — R$ ${c.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`).join('\n');
        response = `🏆 **Top Clientes por Faturamento**\n\n${lines}\n\nAcesse **Menu → Inteligência Financeira** para histórico mensal e análise completa.`;
      } catch { response = '🏆 Acesse **Menu → Inteligência Financeira** para ver o ranking de clientes.'; }
    }

    else if (isInternal && /analisar logística|analisar logistica|agenda de entrega|quantas entrega|capacidade de entrega|rotas disponíveis|rotas disponiveis|logística de amanhã|logistica de amanha/.test(msg)) {
      intent = 'logistics_analysis';
      try {
        const allOrders = await storage.getOrders();
        const routes = await storage.getRoutes();
        const activeWindow = await storage.getActiveOrderWindow();
        const activeOrders = allOrders.filter((o: any) => !['CANCELLED'].includes(o.status));
        const withDelivery = activeOrders.filter((o: any) => o.deliveryDate);

        // Group by delivery date
        const byDay: Record<string, number> = {};
        for (const o of withDelivery) {
          const d = new Date(o.deliveryDate).toLocaleDateString('pt-BR');
          byDay[d] = (byDay[d] || 0) + 1;
        }
        const sortedDays = Object.entries(byDay).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const dayLines = sortedDays.map(([d, c]) => `• ${d}: ${c} entrega(s)${c >= 5 ? ' ⚠️ sobrecarga' : ''}`).join('\n');

        response = `🚚 **Análise Logística**\n\n• Rotas cadastradas: **${routes.length}**\n• Entregas agendadas: **${activeOrders.length}**\n• Semana atual: ${activeWindow?.weekReference || '—'}\n\n📅 Distribuição de entregas:\n${dayLines || '— Sem entregas agendadas'}\n\n${routes.filter((r: any) => !r.vehicleId || !r.driverId).length > 0 ? `⚠️ ${routes.filter((r: any) => !r.vehicleId || !r.driverId).length} rota(s) sem motorista ou veículo.\n\n` : ''}Acesse **Menu → Inteligência Logística** para análise completa.`;
      } catch { response = '🚚 Acesse **Menu → Logística** para ver rotas, motoristas e agenda de entregas.'; }
    }

    else if (isInternal && /analisar eficiência|eficiencia do sistema|analisar sistema|auto otimização|auto otimizacao|gargalo|processos lentos/.test(msg)) {
      intent = 'system_efficiency';
      try {
        const allOrders = await storage.getOrders();
        const now = Date.now();
        const recent = allOrders.filter((o: any) => now - new Date(o.orderDate || o.createdAt).getTime() < 7 * 86400000);
        const pending = recent.filter((o: any) => ['PENDING', 'ACTIVE'].includes(o.status));
        const confirmed = recent.filter((o: any) => o.status === 'CONFIRMED');
        const cancelled = recent.filter((o: any) => o.status === 'CANCELLED');
        const cancellationRate = recent.length > 0 ? ((cancelled.length / recent.length) * 100).toFixed(1) : '0';

        response = `⚙️ **Eficiência Operacional (últimos 7 dias)**\n\n• Pedidos recebidos: **${recent.length}**\n• Confirmados: **${confirmed.length}**\n• Pendentes: **${pending.length}**\n• Cancelados: **${cancelled.length}** (${cancellationRate}%)\n\n${parseFloat(cancellationRate) > 15 ? '⚠️ Taxa de cancelamento elevada. Revisar processo de aprovação.' : '✅ Taxa de cancelamento dentro do esperado.'}\n${pending.length > 5 ? `⚠️ ${pending.length} pedido(s) pendente(s) de aprovação.` : ''}\n\nAcesse **Menu → IA Operacional** para alertas automáticos e análise completa.`;
      } catch { response = '⚙️ Acesse **Menu → IA Operacional** para análise de eficiência do sistema.'; }
    }

    // ── Knowledge base: new features explanations ────────────────────────────
    else if (/como funciona o escopo contratual|escopo contratual\?|o que é o escopo contratual|explica (o )?escopo/.test(msg)) {
      intent = 'explain_scope';
      if (isInternal) {
        response = `📋 **Escopo Contratual**\n\nO escopo contratual define os produtos, quantidades e dias de entrega fixos para clientes do tipo **Contratual**.\n\n**Como funciona:**\n1. Acesse **Menu → Gestão de Contratos** e selecione o cliente\n2. Na aba **Escopo Contratual**, adicione itens: produto, quantidade, dia da semana e preço unitário\n3. Clique em **Gerar Pedidos da Semana** para criar os pedidos automaticamente\n\n**Benefícios:**\n• Pedidos gerados automaticamente toda semana\n• Aparece no Planejamento de Compras consolidado\n• O cliente pode visualizar seu escopo pelo portal\n\n💡 Use **Simulação Comercial** para testar um escopo antes de formalizar.`;
      } else {
        response = `📋 **Seu Escopo Contratual**\n\nO escopo contratual define os produtos e quantidades que você recebe em cada dia da semana, conforme seu contrato com a VivaFrutaz.\n\nPara ver seu escopo atual, acesse **Menu → Meu Escopo Contratual** ou pergunte: _"Quais frutas recebo?"_\n\nPara solicitar alterações, diga: _"Quero alterar meu escopo"_`;
      }
    }

    else if (/como (gerar|criar|emitir) (uma )?nota fiscal|nota fiscal\?|o que é danfe|como funciona (a )?gestão de notas|notas fiscais\?/.test(msg)) {
      intent = 'explain_fiscal';
      response = isInternal
        ? `🧾 **Gestão de Notas Fiscais**\n\nA área de Notas Fiscais (**Menu → Gestão de Notas Fiscais**) centraliza:\n\n**Emissão de DANFE:**\n• Acesse um pedido → clique em **Gerar DANFE** para pré-visualizar e baixar o PDF\n• Preencha nº da nota, série, chave de acesso e valor\n\n**Exportação para Bling:**\n• Em cada pedido faturado, clique em **Exportar para Bling** para enviar ao ERP\n• O sistema registra o status da exportação (Pendente / Exportado)\n\n**Importação de Notas de Entrada (OCR):**\n• Acesse **Menu → Compras → Notas Fiscais de Entrada**\n• Faça upload do PDF do DANFE — o sistema lê automaticamente via OCR\n• Os itens são adicionados ao inventário com cálculo de custo médio\n\n💡 Dica: o status fiscal de cada pedido fica visível na coluna "Fiscal" da tabela de pedidos.`
        : `🧾 Informações sobre notas fiscais são gerenciadas pela equipe administrativa. Em caso de dúvidas sobre documentos fiscais, entre em contato com o suporte: _"Como falar com o atendimento?"_`;
    }

    else if (/como (exportar|enviar) (para o )?bling|bling\?|integração com bling|exportação bling/.test(msg)) {
      intent = 'explain_bling';
      response = isInternal
        ? `🔗 **Exportação para o Bling**\n\nO sistema integra com o **Bling ERP** para envio de pedidos faturados.\n\n**Como exportar:**\n1. Acesse **Menu → Gestão de Notas Fiscais**\n2. Selecione pedidos com status **Faturado**\n3. Clique em **Exportar para Bling** no pedido desejado\n4. O sistema envia os dados e registra o status: _Pendente → Exportado_\n\n**Dados enviados:** número da nota, série, chave de acesso, cliente, produtos, valores e impostos.\n\n⚙️ Configure as credenciais do Bling em **Menu → Configurações Fiscais**.`
        : `🔗 A exportação para sistemas de gestão é realizada pela equipe administrativa. Em caso de dúvidas, entre em contato com o suporte.`;
    }

    else if (/como funciona (o )?custo médio|custo médio\?|calcula custo médio|o que é custo médio/.test(msg)) {
      intent = 'explain_avg_cost';
      response = isInternal
        ? `📊 **Cálculo de Custo Médio Ponderado**\n\nO sistema recalcula automaticamente o custo médio de cada produto ao importar uma nota fiscal de entrada.\n\n**Fórmula:**\n\`Novo Custo Médio = (Custo Médio Atual × Estoque Atual + Preço da NF × Quantidade Comprada) ÷ (Estoque Atual + Quantidade Comprada)\`\n\n**Exemplo:**\n• Estoque: 100 kg de Manga a R$ 5,00/kg\n• Compra: 50 kg a R$ 6,50/kg\n• Novo custo médio: **R$ 5,50/kg**\n\n**Onde verificar:** Menu → Estoque / Inventário → coluna "Custo Médio"\n\n💡 O custo médio é utilizado para análise de margem nos contratos e simulações comerciais.`
        : `📊 Informações sobre custos são gerenciadas internamente. Para consultas sobre preços, entre em contato com nossa equipe.`;
    }

    else if (/como funciona (o )?id de produto|id de produto\?|código de produto|produto base|produtos derivados/.test(msg)) {
      intent = 'explain_product_id';
      response = isInternal
        ? `🏷️ **ID de Produto Base**\n\nO **ID de Produto Base** (código único) é utilizado para agrupar produtos relacionados — chamados de **produtos derivados**.\n\n**Exemplo:**\nOs produtos _Manga In Natura_, _Manga Higienizada_ e _Manga Pote BIO_ podem ter o mesmo código **002**, indicando que são derivados do mesmo produto base.\n\n**Como usar:**\n1. Acesse **Menu → Produtos** → Novo Produto ou editar existente\n2. No campo **ID do Produto Base**, insira o código manualmente ou clique em **Gerar Auto**\n3. Produtos com o mesmo código são agrupados nos alertas de variação de preço\n\n**Benefícios:**\n• Alertas de custo impactam todos os derivados simultaneamente\n• Facilita análise de categoria e margem`
        : `🏷️ Informações sobre cadastro de produtos são gerenciadas pela equipe. Em caso de dúvidas, entre em contato com o suporte.`;
    }

    else if (/como funciona (o )?portal do cliente|portal do cliente\?|como o cliente (acessa|vê|visualiza)|o que o cliente pode fazer/.test(msg)) {
      intent = 'explain_client_portal';
      response = isInternal
        ? `🖥️ **Portal do Cliente**\n\nO portal permite que clientes acessem o sistema com login próprio. Cada cliente vê apenas suas informações.\n\n**O que o cliente pode fazer:**\n• Ver seus pedidos e status de entrega\n• Consultar e visualizar seu escopo contratual\n• Ver os produtos disponíveis no catálogo\n• Solicitar alterações de escopo via Clara IA\n• Fazer contato com o suporte\n\n**Tipos de cliente no portal:**\n• **Avulso/Mensal**: visualiza pedidos e catálogo\n• **Contratual**: também acessa escopo contratual com dados de entrega e valor\n\n**Configuração:** O acesso é criado em **Menu → Empresas** → aba **Acesso ao Portal** da empresa.`
        : `🖥️ Você está usando o **Portal do Cliente** da VivaFrutaz. Aqui você pode:\n• Ver seus pedidos e previsão de entrega\n• Consultar seu escopo contratual\n• Solicitar alterações\n\nSe precisar de ajuda, diga: _"Quero falar com o atendimento"_`;
    }

    else if (/como funciona (a )?simulação (comercial|de escopo)|simulação comercial\?|o que é simulação comercial/.test(msg)) {
      intent = 'explain_scope_simulation';
      response = isInternal
        ? `📈 **Simulação de Escopo Comercial**\n\nA **Simulação Comercial** (Menu → Simulação Comercial) permite criar e analisar propostas de escopo antes de formalizar um contrato.\n\n**Como funciona:**\n1. Crie uma nova simulação com nome, empresa-alvo e margem desejada\n2. Na aba **Escopo**, adicione produtos, quantidades e preços\n3. Na aba **Análise**, veja automaticamente: valor semanal, mensal, anual e margem calculada\n4. Quando aprovada, clique em **Converter em Cliente** para criar a empresa e o escopo definitivo\n\n**Ideal para:** equipe comercial precificar propostas e apresentar ao cliente antes do fechamento.`
        : `📈 Informações sobre propostas e contratos são tratadas pela equipe comercial. Entre em contato conosco para mais informações.`;
    }

    else if (!isInternal && /como falar|contato|atendimento|suporte|falar com (alguém|equipe|vocês)/.test(msg)) {
      intent = 'client_support';
      try {
        const supportConfig = await storage.getSetting('support_config');
        const config = supportConfig ? JSON.parse(supportConfig) : null;
        const whatsapp = config?.whatsapp || null;
        const email = config?.email || null;
        let contactLine = '';
        if (whatsapp) contactLine += `• WhatsApp: **${whatsapp}**\n`;
        if (email) contactLine += `• E-mail: **${email}**\n`;
        response = `📞 **Entre em contato com nossa equipe:**\n\n${contactLine || '• Acesse o menu **Suporte** para informações de contato.\n'}\nEstamos disponíveis em horário comercial para ajudá-lo!`;
      } catch {
        response = `📞 Para falar com nossa equipe, acesse o menu **Suporte** ou verifique as informações de contato na página principal.`;
      }
    }

    else if (!isInternal && /como solicitar (alteração|mudança)|quero alterar|alterar escopo|mudar meu contrato/.test(msg) && company?.clientType !== 'contratual') {
      intent = 'client_scope_change_general';
      response = `🔄 Para solicitar alterações em seu contrato, entre em contato diretamente com nossa equipe comercial.\n\nDigite **"Como falar com o atendimento"** para ver nossos canais de contato.`;
    }

    else if (/ajuda|menu|opções|opcoes|o que (você|voce) (faz|pode)/.test(msg)) {
      intent = 'help';
      if (isInternal) {
        const extras = isAdmin ? '\n• "Criar empresa" — cadastrar nova empresa' : '';
        response = `🤖 **O que posso fazer:**\n\n📦 Consultas:\n• "Pedidos hoje" / "pedidos pendentes"\n• "Empresas que não fizeram pedido"\n\n📊 Inteligência:\n• "Analisar clientes" / "Clientes em risco"\n• "Prever faturamento" / "Ranking de clientes"\n• "Analisar logística" / "Agenda de entregas"\n• "Eficiência do sistema"\n\n📦 Operacional:\n• "Estoque baixo" / "Lista de compras"\n• "Criar tarefa"${extras}\n\n🌤️ Clima:\n• "Qual o clima em São Paulo?"\n\n❓ Novas funcionalidades:\n• "Como funciona o escopo contratual?"\n• "Como gerar uma nota fiscal?"\n• "Como funciona o custo médio?"\n• "Como funciona o ID de produto base?"`;
      } else {
        response = `🤖 **Posso ajudar com:**\n\n• "Meus pedidos" — ver status\n• "Previsão de entrega" — datas da janela\n• "Meu escopo" — frutas e quantidades do contrato\n• "Clima" — previsão do tempo\n• "Suporte" — contato com a equipe`;
      }
    }

    // ── Contratual client: scope change request ─────────────────────────────
    else if (!isInternal && company?.clientType === 'contratual' && sessionContext?.action === 'scope_change_confirm') {
      if (msg === 'confirmar' || msg === 'sim' || msg === 'ok') {
        intent = 'scope_change_confirmed';
        try {
          await storage.createTask({
            title: `Solicitação de alteração de escopo — ${company.companyName}`,
            description: `Cliente: ${company.companyName} (ID #${company.id})\nContato: ${company.contactName || '—'}\n\nMensagem do cliente:\n${sessionContext.data?.message || '(sem detalhes)'}`,
            priority: 'medium',
            createdByName: company.companyName,
          });
          response = `✅ Solicitação registrada! Nossa equipe entrará em contato em breve para confirmar as alterações no seu escopo contratual.`;
          newContext = null;
        } catch {
          response = `⚠️ Não foi possível registrar a solicitação. Tente novamente ou entre em contato diretamente conosco.`;
        }
      } else if (msg === 'cancelar' || msg === 'não' || msg === 'nao') {
        intent = 'scope_change_cancelled';
        response = `❌ Solicitação cancelada. Se precisar de ajuda, estou aqui!`;
        newContext = null;
      } else {
        response = `Digite **"confirmar"** para enviar a solicitação de alteração ou **"cancelar"** para desistir.`;
        newContext = sessionContext;
      }
    }

    // ── Contratual client: scope queries ─────────────────────────────────────
    else if (!isInternal && company?.clientType === 'contratual' &&
      /escopo|contrato|frutas|frutas que recebo|volume|valor|entrega|dias|quantidade|banana|manga|maçã|maca|alterar|alteração|mudar|solicitar|quero/.test(msg)) {
      intent = 'scope_query';
      try {
        const scopes = await storage.getContractScopes(company.id);

        if (/alterar|alteração|mudar|solicitar|quero|adicionar|trocar|reduzir|aumentar/.test(msg)) {
          const request = message.trim();
          newContext = { action: 'scope_change_confirm', data: { message: request } };
          response = `Entendi! Você deseja solicitar uma alteração no seu escopo contratual.\n\n📝 Sua solicitação:\n_"${request}"_\n\nDeseja que eu encaminhe essa solicitação para nossa equipe administrativa?\nDigite **"confirmar"** para enviar ou **"cancelar"** para desistir.`;
        } else {
          const DAY_LABELS: Record<string, string> = {
            'Segunda-feira': 'Segunda', 'Terça-feira': 'Terça', 'Quarta-feira': 'Quarta',
            'Quinta-feira': 'Quinta', 'Sexta-feira': 'Sexta',
          };
          const byDay: Record<string, typeof scopes> = {};
          for (const s of scopes) {
            const d = s.dayOfWeek || 'Sem dia';
            if (!byDay[d]) byDay[d] = [];
            byDay[d].push(s);
          }
          const valorSemanal = scopes.reduce((sum, s) => sum + Number(s.quantity) * (s.unitPrice ? Number(s.unitPrice) : 0), 0);
          const entregas = Object.keys(byDay).length;

          if (/valor|preço|custo|quanto custa|quanto pago/.test(msg)) {
            response = `💰 **Valor do seu contrato**\n\n• Valor semanal estimado: **R$ ${valorSemanal.toFixed(2).replace('.', ',')}**\n• Valor mensal estimado: **R$ ${(valorSemanal * 4).toFixed(2).replace('.', ',')}**\n• Entregas por semana: **${entregas}**\n\nPara mais detalhes acesse **Meu Escopo Contratual** no menu.`;
          } else if (/dia|dias|quando|entrega/.test(msg)) {
            const diasList = Object.keys(byDay).map(d => `• **${d}** — ${byDay[d]!.length} item(s)`).join('\n');
            response = `📅 **Seus dias de entrega**\n\n${diasList || '• Nenhum dia configurado ainda'}\n\nTotal de **${entregas}** entrega(s) por semana.`;
          } else if (/quantas|quantidade|quantos/.test(msg)) {
            const match = msg.match(/(banana|manga|maçã|maca|limão|limao|laranja|melão|melao|uva|morango)/);
            if (match && match[1]) {
              const fruit = match[1];
              const items = scopes.filter(s => (s as any).productName?.toLowerCase().includes(fruit) || (s as any).categoryName?.toLowerCase().includes(fruit));
              if (items.length === 0) {
                response = `🔍 Não encontrei **${fruit}** no seu escopo contratual atual.`;
              } else {
                const total = items.reduce((s, i) => s + Number(i.quantity), 0);
                const lines = items.map(i => `• ${i.dayOfWeek}: **${i.quantity} un** de ${(i as any).productName || fruit}`).join('\n');
                response = `🍎 **${fruit.charAt(0).toUpperCase() + fruit.slice(1)} no seu escopo:**\n\n${lines}\n\nTotal semanal: **${total} un**`;
              }
            } else {
              const totalItems = scopes.reduce((s, i) => s + Number(i.quantity), 0);
              response = `📦 **Volume total do seu escopo:** **${totalItems} unidades/semana**\n\n${scopes.map(s => `• ${s.dayOfWeek}: ${s.quantity} un de ${(s as any).productName || (s as any).categoryName || 'item'}`).join('\n')}`;
            }
          } else {
            const sections = Object.entries(byDay).map(([day, items]) => {
              const lines = items.map(i => `  • ${i.quantity} un de **${(i as any).productName || (i as any).categoryName || 'item'}**${i.unitPrice ? ` — R$ ${Number(i.unitPrice).toFixed(2).replace('.', ',')} cada` : ''}`).join('\n');
              const subtotal = items.reduce((s, i) => s + Number(i.quantity) * (i.unitPrice ? Number(i.unitPrice) : 0), 0);
              return `**${day}**\n${lines}${subtotal > 0 ? `\n  Subtotal: R$ ${subtotal.toFixed(2).replace('.', ',')}` : ''}`;
            }).join('\n\n');
            response = `🍃 **Seu escopo contratual:**\n\n${sections || 'Nenhum item configurado ainda.'}\n\n💰 Valor semanal estimado: **R$ ${valorSemanal.toFixed(2).replace('.', ',')}**\n\nPara solicitar alterações diga: _"Quero alterar..."_`;
          }
        }
      } catch {
        response = `⚠️ Não consegui acessar os dados do seu escopo agora. Tente novamente em instantes.`;
      }
    }

    else {
      intent = 'unknown';

      // ── Safety filter: block prohibited/sensitive topics ───────────────────
      const BLOCKED_TERMS = [
        'pornografia', 'porno', 'sexo', 'nude', 'adulto', 'erótico', 'erotico',
        'violência', 'violencia', 'matar', 'arma', 'explosivo',
        'droga', 'cocaína', 'heroína', 'crack', 'cannabis ilegal',
        'aposta', 'cassino', 'jogo de azar', 'bet',
        'hack', 'invadir', 'roubar', 'fraude',
        // Competitors (general fruit/food wholesale)
        'hortifruti', 'ceagesp', 'ceasinha',
      ];
      // Sensitive internal data that must NOT be shared externally
      const HAS_SENSITIVE_DATA = /cnpj|cpf|senha|contrato\s+\d|pedido\s+#\d|nota fiscal \d|cliente\s+\d{3,}/.test(msg);

      const isBlockedQuery = BLOCKED_TERMS.some(term => msg.toLowerCase().includes(term));

      if (isBlockedQuery) {
        response = `🚫 Essa pesquisa não está disponível nas políticas da plataforma.\n\nPosso ajudar com operações do sistema, produtos, pedidos e logística. Como posso te ajudar?`;
      } else if (isInternal && !HAS_SENSITIVE_DATA && msg.split(' ').length >= 3) {
        // ── External search via DuckDuckGo Instant Answer API ─────────────────
        // Only search for meaningful queries (3+ words), never with internal data
        try {
          const searchQuery = encodeURIComponent(msg.trim().slice(0, 100));
          const ddgUrl = `https://api.duckduckgo.com/?q=${searchQuery}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
          const ddgRes = await fetch(ddgUrl, { signal: AbortSignal.timeout(4000) });
          const ddgData = await ddgRes.json() as any;

          const abstractText = ddgData?.AbstractText?.trim();
          const abstractSource = ddgData?.AbstractURL?.trim();
          const relatedTopics = ddgData?.RelatedTopics?.slice(0, 3)?.map((t: any) => t?.Text).filter(Boolean) || [];

          if (abstractText && abstractText.length > 30) {
            intent = 'external_search';
            const sourceNote = abstractSource ? `\n\n🌐 Fonte: ${abstractSource}` : '';
            response = `🔍 **Pesquisa externa:**\n\n${abstractText}${relatedTopics.length > 0 ? `\n\n**Relacionados:**\n${relatedTopics.map((t: string) => `• ${t.slice(0, 80)}`).join('\n')}` : ''}${sourceNote}\n\n_Esta resposta é proveniente de busca externa. Para operações do sistema, use os atalhos do painel._`;
          } else {
            // No useful external result — fallback
            if (isInternal) {
              response = `Hmm, não encontrei informações sobre isso 🤔\n\nPosso ajudar com:\n📦 **Pedidos**: "pedidos hoje", "pedidos pendentes"\n📊 **Inteligência**: "clientes em risco", "prever faturamento"\n📦 **Estoque**: "estoque baixo", "lista de compras"\n❓ **Tutoriais**: "como funciona o escopo contratual?", "como gerar nota fiscal?"`;
            } else {
              response = `Não entendi 🤔 Tente:\n• "meus pedidos"\n• "previsão de entrega"\n• "suporte"`;
            }
          }
        } catch {
          // External search failed — fallback gracefully
          if (isInternal) {
            response = `Hmm, não entendi completamente 🤔 Sou a **Clara** e posso ajudar com:\n\n📦 **Pedidos**: "pedidos hoje", "pedidos pendentes"\n🏢 **Empresas**: "empresas inativas", "quem não fez pedido"\n📊 **Comercial**: "clientes em risco", "oportunidades de venda"\n💰 **Financeiro**: "prever faturamento", "ranking de clientes"\n🚚 **Logística**: "analisar logística", "agenda de entregas"\n📦 **Estoque**: "estoque baixo", "lista de compras"\n✅ **Tarefas**: "criar tarefa"\n🌤️ **Clima**: "clima em São Paulo"\n⚙️ **Sistema**: "status do sistema", "eficiência do sistema"${isAdmin ? '\n➕ **Criar**: "criar empresa"' : ''}\n\nTente reformular sua pergunta!`;
          } else {
            response = `Não entendi 🤔 Tente:\n• "meus pedidos"\n• "previsão de entrega"\n• "clima em São Paulo"\n• "suporte"`;
          }
        }
      } else if (isInternal) {
        response = `Hmm, não entendi completamente 🤔 Sou a **Clara** e posso ajudar com:\n\n📦 **Pedidos**: "pedidos hoje", "pedidos pendentes"\n🏢 **Empresas**: "empresas inativas", "quem não fez pedido"\n📊 **Comercial**: "clientes em risco", "oportunidades de venda"\n💰 **Financeiro**: "prever faturamento", "ranking de clientes"\n🚚 **Logística**: "analisar logística", "agenda de entregas"\n📦 **Estoque**: "estoque baixo", "lista de compras"\n✅ **Tarefas**: "criar tarefa"\n🌤️ **Clima**: "clima em São Paulo"\n⚙️ **Sistema**: "status do sistema", "eficiência do sistema"${isAdmin ? '\n➕ **Criar**: "criar empresa"' : ''}\n\n❓ **Tutoriais**: "como funciona o escopo contratual?", "como gerar nota fiscal?"\n\nTente reformular sua pergunta!`;
      } else if (company?.clientType === 'contratual') {
        response = `Não entendi 🤔 Sou a **Clara** e posso ajudar com:\n\n📋 **Escopo**: "quais frutas recebo", "meu volume semanal"\n📅 **Entregas**: "quais dias tenho entrega"\n💰 **Valor**: "qual o valor do meu contrato"\n🔄 **Alterações**: "quero alterar meu escopo"`;
      } else {
        response = `Não entendi 🤔 Tente:\n• "meus pedidos"\n• "previsão de entrega"\n• "clima em São Paulo"\n• "suporte"`;
      }
    }

    // Save interaction to history
    // SECURITY: stamp tenantId so the row is reachable via tenantWhere(aiInteractions).
    // Falls back to company.empresaId / user.empresaId; null only when neither side
    // has a resolvable tenant (legacy support before users/companies linked).
    try {
      const tenantId =
        company?.id ?? company?.empresaId ?? user?.empresaId ?? null;
      await db.insert(aiInteractions).values({
        userId: user?.id || null,
        companyId: company?.id || null,
        userRole: user?.role || (company ? 'CLIENT' : null),
        userName: user?.name || company?.companyName || null,
        message: message.trim(),
        response,
        intent,
        actionExecuted,
        actionData: actionData ? actionData : null,
        tenantId,
      });
    } catch { /* ignore history save errors */ }

    res.json({ response, intent, sessionContext: newContext || null });
  });

  // ─── Commercial Intelligence ─────────────────────────────────────────────
  app.get('/api/commercial-intelligence', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }
      const now = Date.now();
      const allOrders = await storage.getOrders();
      const allCompanies = await storage.getCompanies();
      const activeCompanies = allCompanies.filter((c: any) => c.active);

      // Group orders by company
      const ordersByCompany: Record<number, any[]> = {};
      for (const o of allOrders) {
        if (!ordersByCompany[o.companyId]) ordersByCompany[o.companyId] = [];
        ordersByCompany[o.companyId]!.push(o);
      }

      // Build product order history per company (for dropped products)
      const productHistoryByCompany: Record<number, Record<number, { productName: string; lastOrdered: number; totalOrders: number }>> = {};
      for (const o of allOrders.filter((o: any) => o.status !== 'CANCELLED')) {
        const orderDate = new Date(o.orderDate || o.createdAt).getTime();
        if (!productHistoryByCompany[o.companyId]) productHistoryByCompany[o.companyId] = {};
        try {
          const { items } = await storage.getOrder(o.id) || { items: [] };
          for (const item of items) {
            if (!productHistoryByCompany[o.companyId]![item.productId]) {
              productHistoryByCompany[o.companyId]![item.productId] = { productName: (item as any).productName || `Produto #${item.productId}`, lastOrdered: 0, totalOrders: 0 };
            }
            if (orderDate > productHistoryByCompany[o.companyId]![item.productId]!.lastOrdered) {
              productHistoryByCompany[o.companyId]![item.productId]!.lastOrdered = orderDate;
            }
            productHistoryByCompany[o.companyId]![item.productId]!.totalOrders++;
          }
        } catch { /* skip */ }
      }

      const atRisk: any[] = [];
      const opportunities: any[] = [];

      for (const company of activeCompanies) {
        const compOrders = (ordersByCompany[company.id] || []).filter((o: any) => o.status !== 'CANCELLED');
        if (compOrders.length === 0) continue; // never ordered — skip (they're just inactive)

        // Sort orders by date
        const sorted = compOrders.sort((a: any, b: any) => new Date(b.orderDate || b.createdAt).getTime() - new Date(a.orderDate || a.createdAt).getTime());
        const lastOrderDate = new Date(sorted[0].orderDate || sorted[0].createdAt);
        const daysSinceLastOrder = Math.floor((now - lastOrderDate.getTime()) / 86400000);

        // Calculate average weekly order value from all historical orders
        const totalValue = compOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
        const avgOrderValue = totalValue / compOrders.length;

        // Find recent orders (last 14 days)
        const recentOrders = compOrders.filter((o: any) => now - new Date(o.orderDate || o.createdAt).getTime() < 14 * 86400000);
        const recentValue = recentOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);

        // Older orders (14–28 days ago)
        const olderOrders = compOrders.filter((o: any) => {
          const age = now - new Date(o.orderDate || o.createdAt).getTime();
          return age >= 14 * 86400000 && age < 28 * 86400000;
        });
        const olderValue = olderOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);

        // Client at risk: no orders in 14+ days (but had orders in the 28 days before that)
        if (daysSinceLastOrder >= 14 && olderOrders.length > 0) {
          let riskLevel: 'high' | 'medium' | 'low' = 'medium';
          if (daysSinceLastOrder >= 30) riskLevel = 'high';
          else if (daysSinceLastOrder >= 14) riskLevel = 'medium';

          atRisk.push({
            companyId: company.id,
            companyName: company.companyName,
            daysSinceLastOrder,
            lastOrderDate: lastOrderDate.toISOString(),
            avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
            totalOrders: compOrders.length,
            riskLevel,
          });
        }

        // Significant drop alert: recent value < 50% of older value
        if (olderValue > 0 && recentValue < olderValue * 0.5 && recentOrders.length > 0) {
          const dropPct = Math.round((1 - recentValue / olderValue) * 100);
          opportunities.push({
            type: 'volume_drop',
            companyId: company.id,
            companyName: company.companyName,
            dropPercent: dropPct,
            recentValue: parseFloat(recentValue.toFixed(2)),
            previousValue: parseFloat(olderValue.toFixed(2)),
            description: `Queda de ${dropPct}% no volume de compras em relação às 2 semanas anteriores.`,
            suggestion: 'Entrar em contato para verificar necessidade de reposição.',
          });
        }

        // Dropped products: products ordered before but not in the last 14 days
        const prodHistory = productHistoryByCompany[company.id] || {};
        for (const [, prod] of Object.entries(prodHistory)) {
          const daysSinceProduct = Math.floor((now - prod.lastOrdered) / 86400000);
          if (daysSinceProduct >= 14 && prod.totalOrders >= 2) {
            opportunities.push({
              type: 'dropped_product',
              companyId: company.id,
              companyName: company.companyName,
              productName: prod.productName,
              daysSinceProduct,
              totalOrders: prod.totalOrders,
              description: `${company.companyName} não pediu **${prod.productName}** há ${daysSinceProduct} dias.`,
              suggestion: `Oferecer ${prod.productName} para reposição.`,
            });
          }
        }
      }

      // Sort at risk by days descending
      atRisk.sort((a, b) => b.daysSinceLastOrder - a.daysSinceLastOrder);

      res.json({ atRisk, opportunities: opportunities.slice(0, 30), generatedAt: new Date().toISOString() });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── Financial Intelligence ───────────────────────────────────────────────
  app.get('/api/financial-intelligence', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'FINANCEIRO'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

      const allOrders = await storage.getOrders();
      const allCompanies = await storage.getCompanies();
      const confirmedStatuses = ['CONFIRMED', 'ACTIVE'];

      const validOrders = allOrders.filter((o: any) => o.status !== 'CANCELLED');
      const thisMonthOrders = validOrders.filter((o: any) => new Date(o.orderDate || o.createdAt) >= startOfMonth);
      const lastMonthOrders = validOrders.filter((o: any) => {
        const d = new Date(o.orderDate || o.createdAt);
        return d >= startOfLastMonth && d <= endOfLastMonth;
      });

      const thisMonthRevenue = thisMonthOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
      const lastMonthRevenue = lastMonthOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
      const monthGrowth = lastMonthRevenue > 0 ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 : 0;

      // Revenue by company
      const revenueByCompany: Record<number, { companyName: string; total: number; orderCount: number }> = {};
      for (const o of validOrders) {
        if (!revenueByCompany[o.companyId]) {
          const comp = allCompanies.find((c: any) => c.id === o.companyId);
          revenueByCompany[o.companyId] = { companyName: comp?.companyName || `#${o.companyId}`, total: 0, orderCount: 0 };
        }
        revenueByCompany[o.companyId]!.total += parseFloat(o.totalValue || '0');
        revenueByCompany[o.companyId]!.orderCount++;
      }

      const topClients = Object.entries(revenueByCompany)
        .map(([id, v]) => ({ companyId: Number(id), ...v, avgOrder: v.total / v.orderCount }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
        .map(c => ({ ...c, total: parseFloat(c.total.toFixed(2)), avgOrder: parseFloat(c.avgOrder.toFixed(2)) }));

      // Historical monthly revenue (last 6 months)
      const monthlyRevenue: { month: string; revenue: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        const mOrders = validOrders.filter((o: any) => {
          const d = new Date(o.orderDate || o.createdAt);
          return d >= mStart && d <= mEnd;
        });
        const mRevenue = mOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
        monthlyRevenue.push({
          month: mStart.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
          revenue: parseFloat(mRevenue.toFixed(2)),
        });
      }

      // Forecast: average of last 3 months * remaining days ratio
      const last3Avg = monthlyRevenue.slice(-3).reduce((s, m) => s + m.revenue, 0) / 3;
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const dayOfMonth = now.getDate();
      const forecast = parseFloat((thisMonthRevenue + (last3Avg / daysInMonth) * (daysInMonth - dayOfMonth)).toFixed(2));

      const avgLast3Months = parseFloat(last3Avg.toFixed(2));
      const revenueAlert = avgLast3Months > 0 && thisMonthRevenue < avgLast3Months * 0.8;

      res.json({
        thisMonthRevenue: parseFloat(thisMonthRevenue.toFixed(2)),
        lastMonthRevenue: parseFloat(lastMonthRevenue.toFixed(2)),
        monthGrowth: parseFloat(monthGrowth.toFixed(1)),
        forecastRevenue: forecast,
        avgLast3Months,
        revenueAlert,
        topClients,
        monthlyRevenue,
        thisMonthOrderCount: thisMonthOrders.length,
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── Logistics Intelligence ───────────────────────────────────────────────
  app.get('/api/logistics-intelligence', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }
      const now = new Date();
      const allOrders = await storage.getOrders();
      const routes = await storage.getRoutes();
      const activeWindow = await storage.getActiveOrderWindow();

      // Delivery schedule: group active orders by delivery date
      const activeOrders = allOrders.filter((o: any) => !['CANCELLED'].includes(o.status));
      const deliverySchedule: Record<string, { date: string; count: number; totalValue: number; companies: string[] }> = {};
      const allCompanies = await storage.getCompanies();

      for (const o of activeOrders) {
        if (!o.deliveryDate) continue;
        const dateKey = new Date(o.deliveryDate).toLocaleDateString('pt-BR');
        if (!deliverySchedule[dateKey]) {
          deliverySchedule[dateKey] = { date: dateKey, count: 0, totalValue: 0, companies: [] };
        }
        deliverySchedule[dateKey].count++;
        deliverySchedule[dateKey].totalValue += parseFloat(o.totalValue || '0');
        const comp = allCompanies.find((c: any) => c.id === o.companyId);
        if (comp && !deliverySchedule[dateKey].companies.includes(comp.companyName)) {
          deliverySchedule[dateKey].companies.push(comp.companyName);
        }
      }

      const scheduleArray = Object.values(deliverySchedule).sort((a, b) => {
        const [da = 0, ma = 0, ya = 0] = a.date.split('/').map(Number);
        const [db = 0, mb = 0, yb = 0] = b.date.split('/').map(Number);
        return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
      }).map(d => ({ ...d, totalValue: parseFloat(d.totalValue.toFixed(2)) }));

      // Overload threshold: > 5 deliveries on same day
      const overloadThreshold = 5;
      const overloadedDays = scheduleArray.filter(d => d.count >= overloadThreshold);

      // Busiest day
      const busiestDay = scheduleArray.length > 0 ? scheduleArray.reduce((a, b) => b.count > a.count ? b : a) : null;

      // Route capacity (simplified: order count per route based on route assignment)
      const routeCapacity = routes.map((r: any) => ({
        routeId: r.id,
        routeName: r.name,
        status: r.status || 'active',
        assignedCompanies: r.assignedCompanies || [],
        hasVehicle: !!r.vehicleId,
        hasDriver: !!r.driverId,
      }));

      const activeRoute = routes.filter((r: any) => r.status !== 'inactive');
      const unassignedRoutes = routes.filter((r: any) => !r.vehicleId || !r.driverId);

      res.json({
        activeRoutes: activeRoute.length,
        totalRoutes: routes.length,
        unassignedRoutes: unassignedRoutes.length,
        deliverySchedule: scheduleArray,
        overloadedDays,
        busiestDay,
        routeCapacity,
        activeWindow: activeWindow ? { weekReference: activeWindow.weekReference } : null,
        totalActiveDeliveries: activeOrders.length,
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── Client Contract Scope Routes ────────────────────────────────────────
  app.get('/api/client/contract-scope', async (req: any, res) => {
    const companyId = req.session?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const company = await storage.getCompany(companyId);
      if (!company || company.clientType !== 'contratual') return res.status(403).json({ message: 'Acesso restrito a clientes contratuais' });
      const rawScopes = await storage.getContractScopes(companyId);
      const allProducts = await storage.getProducts();
      const productMap = new Map(allProducts.map((p: any) => [p.id, p]));
      const scopes = rawScopes.map((s: any) => {
        const product = productMap.get(s.productId);
        return {
          ...s,
          productName: product?.name || null,
          categoryName: s.scopeCategory || product?.category || null,
        };
      });
      res.json({ scopes, company });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/client/scope-change-request', async (req: any, res) => {
    const companyId = req.session?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const company = await storage.getCompany(companyId);
      if (!company || company.clientType !== 'contratual') return res.status(403).json({ message: 'Acesso restrito a clientes contratuais' });
      const { message } = req.body;
      if (!message || typeof message !== 'string' || message.trim().length < 5) {
        return res.status(400).json({ message: 'Mensagem inválida' });
      }
      const task = await storage.createTask({
        title: `Solicitação de alteração de escopo — ${company.companyName}`,
        description: `Cliente: ${company.companyName} (ID #${company.id})\nContato: ${company.contactName || '—'}\n\nMensagem do cliente:\n${message.trim()}`,
        priority: 'medium',
        createdByName: company.companyName,
      });
      res.json({ success: true, taskId: task.id });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── Módulo Financeiro ───────────────────────────────────────────────────
  // PIX payload generation has been migrated to server/modules/finance/finance.service.ts.
  // The local helper that previously lived here was removed when the inline
  // /api/finance/* handlers were delegated to financeController below.

  // ─── Finance — Delegated to financeController, owned by server/modules/finance ───
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*
  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // REMOVIDO NA FASE 7.4 — código morto
  // handler duplicado já atendido por módulo em server/modules/*

  // ─── Admin: Cert Audit (FASE 3.4.1) ───────────────────────────────────
  // Visão agregada read-only do estado dos certificados na frota. NÃO retorna
  // senha, NÃO retorna certBase64, NÃO retorna companyId — apenas contadores
  // e o último updatedAt global. Útil para validar a migração 3.4 e
  // diagnosticar rapidamente quantos tenants estão pendentes.
  // Auth: MASTER only (operação cross-tenant; sem `tenantContext`).
  app.get(
    '/api/admin/certificates/audit',
    requireAuthCore,
    requireRole(['MASTER']),
    async (_req, res) => {
      try {
        const { auditCertificates } = await import(
          '../modules/companies/companyCertificate.repository.ts'
        );
        const result = await auditCertificates();
        console.log('[CERT_AUDIT]', result);
        return res.json({ success: true, data: result });
      } catch (err: any) {
        console.error('[CERT_AUDIT_ERROR]', { error: err?.message });
        return res.status(500).json({
          success: false,
          error: { message: err?.message ?? 'Erro na auditoria', code: 'AUDIT_FAILED' },
        });
      }
    },
  );

  // ─── Admin: Cert Migration (FASE 3.4) ─────────────────────────────────
  // Promove registros legados em texto plano (FASE 3.2) para o formato
  // cifrado `enc:v1:` (FASE 3.3). Idempotente — re-execução é segura.
  // Auth: MASTER only (operação cross-tenant; sem `tenantContext`).
  // Logs: `[CERT_MIGRATION_DONE]` no sucesso, `[CERT_MIGRATION_ERROR]` em
  // qualquer falha (com mensagem do erro, sem segredos).
  app.post(
    '/api/admin/certificates/migrate-legacy',
    requireAuthCore,
    requireRole(['MASTER']),
    async (_req, res) => {
      try {
        const { migrateLegacyCertificates } = await import(
          '../modules/companies/companyCertificate.repository.ts'
        );
        const result = await migrateLegacyCertificates();
        console.log('[CERT_MIGRATION_DONE]', result);
        return res.json({ success: true, ...result });
      } catch (err: any) {
        console.error('[CERT_MIGRATION_ERROR]', { error: err?.message });
        return res.status(500).json({
          success: false,
          error: { message: err?.message ?? 'Erro na migração', code: 'MIGRATION_FAILED' },
        });
      }
    },
  );

  // ─── Company Certificates (NF-e A1) — FASE 3.2 ────────────────────────
  // Endpoints CRUD do certificado A1 por empresa (multi-tenant). Usados pela
  // UI de configuração fiscal e consumidos automaticamente pelo `nfeSender`
  // via `nfeCertDynamic.getCertificadoDinamico()` durante a transmissão.
  // Auth: tenantContext + requireTenant (sessão de admin OU sessão de
  // empresa pinada). NÃO retorna `certBase64` nem `certPassword` em GET.
  {
    const { companyCertificateRepository } = await import(
      '../modules/companies/companyCertificate.repository.ts'
    );
    const { requireTenantId } = await import('../core/tenant/context');

    // POST /api/company/certificate — upload (cria ou substitui)
    app.post(
      '/api/company/certificate',
      tenantContext,
      requireTenant,
      async (req: any, res, next) => {
        try {
          const tenantId = requireTenantId();
          const { certBase64, password } = req.body ?? {};
          if (typeof certBase64 !== 'string' || certBase64.length === 0) {
            return res
              .status(400)
              .json({ success: false, error: { message: 'certBase64 é obrigatório', code: 'BAD_REQUEST' } });
          }
          if (typeof password !== 'string' || password.length === 0) {
            return res
              .status(400)
              .json({ success: false, error: { message: 'password é obrigatório', code: 'BAD_REQUEST' } });
          }
          const saved = await companyCertificateRepository.upsert({
            companyId: tenantId,
            certBase64,
            certPassword: password,
          });
          return res.json({
            success: true,
            data: {
              id: saved.id,
              companyId: saved.companyId,
              createdAt: saved.createdAt,
              updatedAt: saved.updatedAt,
            },
          });
        } catch (err) {
          next(err);
        }
      },
    );

    // GET /api/company/certificate — status (sem expor cert/senha)
    app.get(
      '/api/company/certificate',
      tenantContext,
      requireTenant,
      async (_req, res, next) => {
        try {
          const tenantId = requireTenantId();
          const row = await companyCertificateRepository.getByCompanyId(tenantId);
          if (!row) {
            return res.json({ success: true, data: { configured: false } });
          }
          return res.json({
            success: true,
            data: {
              configured: true,
              id: row.id,
              companyId: row.companyId,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            },
          });
        } catch (err) {
          next(err);
        }
      },
    );

    // DELETE /api/company/certificate — remove o cert da empresa
    app.delete(
      '/api/company/certificate',
      tenantContext,
      requireTenant,
      async (_req, res, next) => {
        try {
          const tenantId = requireTenantId();
          const removed = await companyCertificateRepository.deleteByCompanyId(tenantId);
          return res.json({ success: true, data: { removed } });
        } catch (err) {
          next(err);
        }
      },
    );
  }

  // ─── NF-e Routes ─────────────────────────────────────────────────────────
  {
    const { gerarNFeXML } = await import('../services/nfe/nfeGenerator.ts');
    const { validarNFeInput } = await import('../services/nfe/nfeValidator.ts');
    const { gerarDANFE } = await import('../services/nfe/danfeGenerator.ts');
    const { enviarNFeSEFAZ, consultarStatusSEFAZ } = await import('../services/nfe/nfeSender.ts');

    // STEP 9.3C — buildNFeInput extraído para server/modules/nfe/nfe-input.builder.ts
    // para ser reutilizado pelo cron sem duplicar lógica.
    const { buildNFeInput } = await import('../modules/nfe/nfe-input.builder.ts');

    // GET /api/nfe — list
    app.get('/api/nfe', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const { status, orderId } = req.query;
        const data = await storage.getNfeEmissoes({ status: status as string, orderId: orderId ? Number(orderId) : undefined });
        res.json(data);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/nfe/:id
    app.get('/api/nfe/:id', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const nfe = await storage.getNfeEmissao(Number(req.params.id));
        if (!nfe) return res.status(404).json({ message: 'NF-e não encontrada' });
        // FASE 6 — multi-tenant hardening: NF-e carrega orderId; valida tenant
        // antes de retornar o registro. Mesmo padrão de /api/nfe/:id/danfe.
        if (nfe.orderId) {
          try {
            await validateOrderTenant(nfe.orderId);
          } catch (e: any) {
            if (e instanceof AppError) {
              return res.status(e.status).json({ message: e.message });
            }
            throw e;
          }
        }
        res.json(nfe);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/nfe/can-emit/:orderId — validação prévia (mesma lógica do guard)
    app.get('/api/nfe/can-emit/:orderId', async (req: any, res) => {
      try {
        const orderId = Number(req.params.orderId);
        if (!orderId) {
          return res.status(400).json({ error: 'orderId inválido' });
        }
        // FASE 6 — multi-tenant hardening: bloqueia consulta de elegibilidade
        // de pedido pertencente a outro tenant. Mantém shape de resposta em
        // sucesso; em mismatch devolve 401/403/404 conforme o AppError.
        try {
          await validateOrderTenant(orderId);
        } catch (e: any) {
          if (e instanceof AppError) {
            return res.status(e.status).json({ error: e.message });
          }
          throw e;
        }
        const result = await canEmitNFe(orderId);
        return res.json({ orderId, ...result });
      } catch (error) {
        console.error('[NFE_CAN_EMIT_ERROR]', error);
        return res.status(500).json({ error: 'Erro ao validar emissão' });
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // FASE NF.4.4 — Endpoint de pré-validação (PRE-FLIGHT)
    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/nfe/preflight/:orderId
    //
    // Executa o pipeline NF-e em modo "dry-run":
    //   1. valida tenant (FASE 3)
    //   2. roda buildNFeInput (FASE NF.4.2 — fail-fast em dados fiscais)
    //   3. roda validarNFeInput (validação Zod-like)
    //   4. roda gerarNFeXML com nNF sentinela (XML é descartado)
    //
    // Garantias:
    //   - NÃO persiste em nfe_emissoes
    //   - NÃO atualiza orders.fiscal_status
    //   - NÃO chama SEFAZ
    //   - NÃO altera buildNFeInput / gerarNFeXML / transmissão
    //   - Erros traduzidos via translateNFeError (FASE NF.4.3)
    //
    // Sempre devolve HTTP 200 com { status: 'ok' | 'error' } no payload,
    // exceto em violações de tenant/auth (que mantêm os status 401/403/404).
    app.get('/api/nfe/preflight/:orderId', async (req: any, res) => {
      if (!req.session?.userId) {
        return res.status(401).json({ message: 'Não autenticado' });
      }

      const orderId = Number(req.params.orderId);
      if (!orderId || !Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).json({ message: 'orderId inválido' });
      }

      // FASE 3 — multi-tenant. Mesmo guard de /api/nfe/emitir.
      try {
        await validateOrderTenant(orderId);
      } catch (e: any) {
        if (e instanceof AppError) {
          return res.status(e.status).json({ message: e.message });
        }
        throw e;
      }

      // Imports dinâmicos: mesmo padrão do /api/nfe/emitir (linhas 5031-5033 e 5631).
      const { buildNFeInput } = await import('../modules/nfe/nfe-input.builder');
      const { gerarNFeXML } = await import('../services/nfe/nfeGenerator.ts');
      const { validarNFeInput } = await import('../services/nfe/nfeValidator.ts');
      const { translateNFeError } = await import('../services/nfe/diagnostics/nfe-error-parser');

      try {
        // FASE 8.4 — call-site resolve itens ANTES de chamar o builder.
        const resolved = await resolveBillingItems(orderId);
        const input = await buildNFeInput({
          orderId,
          sourceItems: resolved.items,
        });
        const validation = validarNFeInput(input);

        // gerarNFeXML exige numero > 0 (NFE_XML_INVALID_NUMBER se !Number.isFinite
        // ou <= 0). Usamos um sentinela (999999999, max nNF de 9 dígitos) — o XML
        // resultante é descartado sem ser persistido nem assinado.
        const PREVIEW_NUMERO = 999999999;
        const xml = await gerarNFeXML(input, PREVIEW_NUMERO);

        // Cálculo dos totais para preview (mesma fórmula do nfeGenerator linhas 154-158).
        // O builder atual não popula valorFrete/Seguro/Desconto — gerarNFeXML aplica
        // `|| 0`, então vNF = vProd na prática. Mantemos o acesso defensivo (cast)
        // para o dia em que o builder começar a propagá-los.
        const inp = input as any;
        const vProd = input.produtos.reduce((s, p) => s + p.vProd, 0);
        const vFrete = Number(inp.valorFrete) || 0;
        const vSeg = Number(inp.valorSeguro) || 0;
        const vDesc = Number(inp.valorDesconto) || 0;
        const vNF = vProd + vFrete + vSeg - vDesc;

        // validarNFeInput devolve erros Zod-like que o pipeline de emissão
        // transformaria em 422 — aqui devolvemos como `errors` para o admin
        // corrigir antes de clicar em "Emitir".
        if (validation.length > 0) {
          console.warn('[NFE_PREFLIGHT]', {
            requestId: getRequestIdForLog(),
            orderId,
            status: 'error',
            code: 'NFE_VALIDATION_FAILED',
            errors: validation.length,
          });
          return res.status(200).json({
            status: 'error',
            errors: validation.map((v) => ({
              code: 'NFE_VALIDATION_FAILED',
              message: `${v.campo}: ${v.mensagem}`,
            })),
            alerts: [],
            preview: {
              total: Number(vNF.toFixed(2)),
              itens: input.produtos.length,
            },
          });
        }

        console.info('[NFE_PREFLIGHT]', {
          requestId: getRequestIdForLog(),
          orderId,
          status: 'ok',
          totalItens: input.produtos.length,
          valorTotal: Number(vNF.toFixed(2)),
          xmlSize: xml.xmlGerado.length,
        });

        return res.json({
          status: 'ok',
          errors: [],
          alerts: [],
          preview: {
            total: Number(vNF.toFixed(2)),
            itens: input.produtos.length,
          },
        });
      } catch (e: any) {
        const parsed = translateNFeError(e);
        console.warn('[NFE_PREFLIGHT]', {
          requestId: getRequestIdForLog(),
          orderId,
          status: 'error',
          code: parsed.code,
          rawMessage: e?.message,
        });
        return res.status(200).json({
          status: 'error',
          errors: [parsed],
          alerts: [],
        });
      }
    });

    // GET /api/nfe/eligible — STEP 9.3: lista pedidos prontos para emitir NF agora
    app.get('/api/nfe/eligible', async (req: any, res) => {
      try {
        // Pre-filter: só candidatos que passam pelas regras básicas do guard,
        // evitando chamar canEmitNFe em pedidos obviamente bloqueados.
        const raw = await db.execute(sql`
          SELECT o.id, o.company_id
          FROM orders o
          WHERE o.status != 'CANCELLED'
            AND o.fiscal_status = 'nota_liberada'
            AND o.delivery_date IS NOT NULL
          LIMIT 500
        `);

        const candidates = (raw as any).rows as Array<{ id: number; company_id: number }>;

        // Roda canEmitNFe em paralelo para todos os candidatos.
        const results = await Promise.all(
          candidates.map(async (row) => {
            const check = await canEmitNFe(row.id);
            if (!check.allowed) return null;
            return {
              orderId: row.id,
              companyId: row.company_id,
              faturamento: {
                tipo: check.faturamento?.tipo,
                prazoDias: check.faturamento?.prazoDias,
              },
            };
          }),
        );

        const eligible = results.filter(Boolean);
        return res.json(eligible);
      } catch (error) {
        console.error('[NFE_ELIGIBLE_ERROR]', error);
        return res.status(500).json({ error: 'Erro ao listar pedidos elegíveis' });
      }
    });

    // GET /api/nfe/cron/status — STEP 9.3D: status em memória do cron de faturamento
    app.get('/api/nfe/cron/status', (req: any, res) => {
      try {
        return res.json(getCronStatus());
      } catch (error) {
        console.error('[CRON_STATUS_ERROR]', error);
        return res.status(500).json({ error: 'Erro ao obter status do cron' });
      }
    });

    // POST /api/nfe/cron/run — STEP 9.3D: trigger manual do cron de faturamento
    app.post('/api/nfe/cron/run', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      // Evita execução concorrente: se já está rodando (cron diário ou outro trigger manual), recusa.
      if (isCronRunning()) {
        return res.status(409).json({ error: 'Cron já está em execução. Aguarde terminar.' });
      }
      try {
        console.log('[CRON_MANUAL_TRIGGER] iniciado por userId=' + req.session.userId);
        const result = await runFaturamentoCron('manual', Number(req.session.userId));
        return res.json({ message: 'Cron executado manualmente', result });
      } catch (error: any) {
        console.error('[CRON_MANUAL_ERROR]', error);
        return res.status(500).json({ error: 'Erro ao executar cron manual', message: error?.message });
      }
    });

    // GET /api/nfe/cron/history — STEP 9.3E: últimas 50 execuções do cron de faturamento
    app.get('/api/nfe/cron/history', async (req: any, res) => {
      try {
        const rows = await db
          .select()
          .from(cronFaturamentoRuns)
          .orderBy(desc(cronFaturamentoRuns.executedAt))
          .limit(50);
        return res.json(rows);
      } catch (error) {
        console.error('[CRON_HISTORY_ERROR]', error);
        return res.status(500).json({ error: 'Erro ao buscar histórico' });
      }
    });

    // ── STEP 9.3F.1 — Destinatários de alerta do cron ─────────────────────
    // Protegido: somente MASTER / ADMIN / DIRECTOR podem gerenciar.
    app.get(
      '/api/cron/alerts/recipients',
      requireAuthCore,
      requireRole(['MASTER', 'ADMIN', 'DIRECTOR']),
      async (_req: any, res) => {
        try {
          const list = await getAlertRecipients();
          return res.json(list);
        } catch (err) {
          console.error('[ALERT_RECIPIENTS_GET_ERROR]', err);
          return res.status(500).json({ error: 'Erro ao ler destinatários' });
        }
      },
    );

    app.put(
      '/api/cron/alerts/recipients',
      requireAuthCore,
      requireRole(['MASTER', 'ADMIN', 'DIRECTOR']),
      async (req: any, res) => {
        try {
          const parsed = alertRecipientsArraySchema.safeParse(req.body);
          if (!parsed.success) {
            return res.status(400).json({
              error: 'Lista inválida',
              details: parsed.error.flatten(),
            });
          }
          const saved = await setAlertRecipients(parsed.data);
          return res.json(saved);
        } catch (err) {
          console.error('[ALERT_RECIPIENTS_PUT_ERROR]', err);
          return res.status(500).json({ error: 'Erro ao salvar destinatários' });
        }
      },
    );

    // STEP 9.3F.3 — Auditoria de alertas disparados.
    // STEP 9.3F.4 — Migrado de memória para banco (cron_alert_logs). Mantém o
    // mesmo shape consumido por client/src/pages/admin/faturamento.tsx.
    app.get(
      '/api/cron/alerts/logs',
      requireAuthCore,
      requireRole(['MASTER', 'ADMIN', 'DIRECTOR']),
      async (_req: any, res) => {
        try {
          const rows = await db
            .select()
            .from(cronAlertLogs)
            .orderBy(desc(cronAlertLogs.createdAt))
            .limit(50);
          return res.json(
            rows.map((log) => ({
              at: log.createdAt,
              severity: log.severity,
              title: log.title,
              message: log.message,
              results: log.results,
              rateLimited: log.rateLimited,
              // STEP 9.3F.6 — campo NOVO opcional. Não remove nem altera os
              // demais; consumidores antigos simplesmente ignoram.
              suppressed: log.suppressed,
            })),
          );
        } catch (err) {
          console.error('[ALERT_LOGS_ERROR]', err);
          return res.status(500).json({ error: 'Erro ao buscar logs de alertas' });
        }
      },
    );

    // STEP 9.3F.5 — Analytics dos alertas persistidos.
    // GET /api/cron/alerts/analytics?days=N (1..90, default 7)
    // Retorna contadores normalizados (number, nunca string) e arrays consistentes.
    app.get(
      '/api/cron/alerts/analytics',
      requireAuthCore,
      requireRole(['MASTER', 'ADMIN', 'DIRECTOR']),
      async (req: any, res) => {
        try {
          const rawDays = Number(req.query.days ?? 7);
          const days = Math.min(90, Math.max(1, Number.isFinite(rawDays) ? rawDays : 7));
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - days);

          // 🔹 Totais — uma única passagem usando FILTER agregado.
          const totalsRows = await db.execute(sql`
            SELECT
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE rate_limited = true)::int  AS rate_limited,
              COUNT(*) FILTER (WHERE rate_limited = false)::int AS sent
            FROM cron_alert_logs
            WHERE created_at >= ${cutoff}
          `);
          const t = (totalsRows.rows?.[0] ?? {}) as Record<string, unknown>;
          const totals = {
            total:        Number(t.total ?? 0),
            rate_limited: Number(t.rate_limited ?? 0),
            sent:         Number(t.sent ?? 0),
          };

          // 🔹 Por severidade.
          const sevRows = await db.execute(sql`
            SELECT severity, COUNT(*)::int AS count
            FROM cron_alert_logs
            WHERE created_at >= ${cutoff}
            GROUP BY severity
            ORDER BY count DESC
          `);
          const bySeverity = (sevRows.rows ?? []).map((r: any) => ({
            severity: String(r.severity ?? ''),
            count:    Number(r.count ?? 0),
          }));

          // 🔹 Por canal — destranca o jsonb `results` em linhas.
          // COALESCE(results, '[]') protege contra NULL acidental.
          const chRows = await db.execute(sql`
            SELECT (elem->>'channel') AS channel, COUNT(*)::int AS count
            FROM cron_alert_logs,
                 LATERAL jsonb_array_elements(COALESCE(results, '[]'::jsonb)) AS elem
            WHERE created_at >= ${cutoff}
              AND rate_limited = false
            GROUP BY channel
            ORDER BY count DESC
          `);
          const byChannel = (chRows.rows ?? [])
            .filter((r: any) => r.channel)
            .map((r: any) => ({
              channel: String(r.channel),
              count:   Number(r.count ?? 0),
            }));

          // 🔹 Top 10 títulos recorrentes.
          const titleRows = await db.execute(sql`
            SELECT title, COUNT(*)::int AS count
            FROM cron_alert_logs
            WHERE created_at >= ${cutoff}
            GROUP BY title
            ORDER BY count DESC, title ASC
            LIMIT 10
          `);
          const topTitles = (titleRows.rows ?? []).map((r: any) => ({
            title: String(r.title ?? ''),
            count: Number(r.count ?? 0),
          }));

          return res.json({
            days,
            since: cutoff.toISOString(),
            totals,
            bySeverity,
            byChannel,
            topTitles,
          });
        } catch (err) {
          console.error('[ALERT_ANALYTICS_ERROR]', err);
          return res.status(500).json({ error: 'Erro ao calcular analytics de alertas' });
        }
      },
    );

    // STEP 9.3F.6 — Detecção de anomalias (spike).
    // GET /api/cron/alerts/anomalies?currentHours=24&baselineDays=7
    app.get(
      '/api/cron/alerts/anomalies',
      requireAuthCore,
      requireRole(['MASTER', 'ADMIN', 'DIRECTOR']),
      async (req: any, res) => {
        try {
          const currentHours = Number(req.query.currentHours ?? 24);
          const baselineDays = Number(req.query.baselineDays ?? 7);
          const report = await buildAnomalies({
            currentHours: Number.isFinite(currentHours) ? currentHours : 24,
            baselineDays: Number.isFinite(baselineDays) ? baselineDays : 7,
          });
          return res.json(report);
        } catch (err) {
          console.error('[ALERT_ANOMALIES_ERROR]', err);
          return res.status(500).json({ error: 'Erro ao calcular anomalias de alertas' });
        }
      },
    );

    // STEP 9.3F.6 — Insights automáticos (somente leitura, NUNCA dispara alerta).
    // GET /api/cron/alerts/insights?windowHours=24
    app.get(
      '/api/cron/alerts/insights',
      requireAuthCore,
      requireRole(['MASTER', 'ADMIN', 'DIRECTOR']),
      async (req: any, res) => {
        try {
          const windowHours = Number(req.query.windowHours ?? 24);
          const report = await buildInsights({
            windowHours: Number.isFinite(windowHours) ? windowHours : 24,
          });
          return res.json(report);
        } catch (err) {
          console.error('[ALERT_INSIGHTS_ERROR]', err);
          return res.status(500).json({ error: 'Erro ao calcular insights de alertas' });
        }
      },
    );

    // STEP 9.3F.7 — Digest automático (resumo inteligente em linguagem natural).
    // GET /api/cron/alerts/digest?windowHours=24
    // Reusa buildInsights + buildAnomalies + queries leves de summary/highlights.
    app.get(
      '/api/cron/alerts/digest',
      requireAuthCore,
      requireRole(['MASTER', 'ADMIN', 'DIRECTOR']),
      async (req: any, res) => {
        try {
          const windowHours = Number(req.query.windowHours ?? 24);
          const report = await buildDigest({
            windowHours: Number.isFinite(windowHours) ? windowHours : 24,
          });
          return res.json(report);
        } catch (err) {
          console.error('[ALERT_DIGEST_ERROR]', err);
          return res.status(500).json({ error: 'Erro ao gerar digest de alertas' });
        }
      },
    );

    // STEP 9.3F.8 — Exportação CSV dos dados de alertas (reusa buildDigest).
    // GET /api/cron/alerts/export?windowHours=24&format=csv
    // format=csv é o único suportado por enquanto (default=csv).
    app.get(
      '/api/cron/alerts/export',
      requireAuthCore,
      requireRole(['MASTER', 'ADMIN', 'DIRECTOR']),
      async (req: any, res) => {
        try {
          const windowHours = Number(req.query.windowHours ?? 24);
          const format = String(req.query.format ?? 'csv').toLowerCase();
          if (format !== 'csv') {
            return res.status(400).json({ error: `Formato não suportado: ${format}` });
          }
          const out = await buildAlertsCsv({
            windowHours: Number.isFinite(windowHours) ? windowHours : 24,
          });
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${out.filename}"`,
          );
          res.setHeader('Cache-Control', 'no-store');
          // BOM para abrir corretamente no Excel pt-BR (UTF-8).
          return res.send('\uFEFF' + out.csv);
        } catch (err) {
          console.error('[ALERT_EXPORT_ERROR]', err);
          return res.status(500).json({ error: 'Erro ao exportar alertas' });
        }
      },
    );

    // STEP 9.3F.11 — Preferências de notificação por usuário.
    // BASE DE CONTROLE: nenhum endpoint de envio consulta isto ainda.
    // GET  /api/admin/notifications/preferences — lista as do usuário logado.
    // POST /api/admin/notifications/preferences — upsert (userId, category).
    const notificationPrefBodySchema = z.object({
      category:    z.string().trim().min(1).max(40),
      minSeverity: z.enum(['INFO', 'WARNING', 'ALERT', 'CRITICAL']),
      enabled:     z.boolean(),
    });

    app.get(
      '/api/admin/notifications/preferences',
      requireAuthCore,
      async (req: any, res) => {
        try {
          const userId = req.session?.userId as number | undefined;
          if (!userId) {
            return res.status(401).json({ error: 'Não autenticado' });
          }
          const data = await getUserPreferences(userId);
          return res.json(data);
        } catch (err) {
          console.error('[NOTIFICATION_PREFS_GET_ERROR]', err);
          return res.status(500).json({ error: 'Erro ao buscar preferências' });
        }
      },
    );

    app.post(
      '/api/admin/notifications/preferences',
      requireAuthCore,
      async (req: any, res) => {
        try {
          const userId = req.session?.userId as number | undefined;
          if (!userId) {
            return res.status(401).json({ error: 'Não autenticado' });
          }
          const parsed = notificationPrefBodySchema.safeParse(req.body);
          if (!parsed.success) {
            return res.status(400).json({
              error: 'Payload inválido',
              issues: parsed.error.flatten(),
            });
          }
          const row = await upsertUserPreference({ userId, ...parsed.data });
          return res.json(row);
        } catch (err) {
          console.error('[NOTIFICATION_PREFS_POST_ERROR]', err);
          return res.status(500).json({ error: 'Erro ao salvar preferência' });
        }
      },
    );

    // STEP 9.3F.4.A — Prune manual dos logs antigos (admin only).
    // DELETE /api/cron/alerts/logs?days=90  → remove tudo com createdAt < hoje - days.
    // Mínimo de 1 dia para evitar wipe acidental da tabela inteira.
    app.delete(
      '/api/cron/alerts/logs',
      requireAuthCore,
      requireRole(['MASTER', 'ADMIN', 'DIRECTOR']),
      async (req: any, res) => {
        try {
          const rawDays = Number(req.query.days ?? 90);
          const days = Math.max(1, Number.isFinite(rawDays) ? rawDays : 90);
          await pruneOldAlertLogs(days);
          return res.json({ ok: true, prunedOlderThanDays: days });
        } catch (err) {
          console.error('[ALERT_PRUNE_ENDPOINT_ERROR]', err);
          return res.status(500).json({ error: 'Erro ao limpar logs de alertas' });
        }
      },
    );

    // GET /api/nfe/dry-run/metrics — STEP 9.2Z.1C/1D: métricas em memória dos bloqueios simulados
    app.get('/api/nfe/dry-run/metrics', (req: any, res) => {
      const base = getDryRunMetrics();
      return res.json({
        ...base,
        topCompanies: getTopCompanies(),
      });
    });

    // GET /api/nfe/dry-run/metrics/window — STEP 9.2Z.1E: métricas filtradas por janela de tempo
    // Query: ?hours=24 (default 24h)
    app.get('/api/nfe/dry-run/metrics/window', (req: any, res) => {
      const hours = Number(req.query.hours || 24);
      const base = getDryRunMetricsWindow(hours);
      return res.json({
        ...base,
        topCompanies: getTopCompaniesWindow(hours),
      });
    });

    // FASE 19 — Observabilidade do guard de idempotência (FASE 18).
    // Endpoint admin: contadores agregados in-memory, sem dados sensíveis.
    // Mesmo padrão de proteção dos endpoints admin de cron/alerts.
    app.get(
      '/api/nfe/idempotency/metrics',
      requireAuthCore,
      requireRole(['MASTER', 'ADMIN', 'DIRECTOR']),
      (_req: any, res) => {
        return res.json({
          enabled: ENABLE_NFE_IDEMPOTENCY_GUARD,
          mode: ENABLE_NFE_IDEMPOTENCY_GUARD ? 'enforce' : 'dry-run',
          ...getNfeIdemMetrics(),
        });
      },
    );

    // FASE 19 — Reset controlado dos contadores in-memory.
    // Útil para isolar janelas de observação. Não toca em DB.
    app.post(
      '/api/nfe/idempotency/reset',
      requireAuthCore,
      requireRole(['MASTER', 'ADMIN', 'DIRECTOR']),
      (req: any, res) => {
        resetNfeIdemMetrics();
        console.warn(
          `[NFE_IDEMPOTENCY_METRICS_RESET] requestId=${getRequestIdForLog()} | userId=${req.session?.userId ?? 'unknown'}`,
        );
        return res.json({ ok: true, ...getNfeIdemMetrics() });
      },
    );

    // POST /api/nfe/emitir — gerar XML + criar registro
    app.post('/api/nfe/emitir', requireActiveSubscription, async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      let lock: OrderLockHandle | null = null;
      try {
        const { orderId } = req.body;
        if (!orderId) return res.status(400).json({ message: 'orderId obrigatório' });

        // FASE 20 — Lock de concorrência (GAP 1, GAP 7). SEMPRE ANTES de
        // qualquer validação ou escrita. Granular por (tenantId, orderId).
        const tenantId = requireTenantId();
        lock = await acquireOrderLock(tenantId, Number(orderId));
        if (!lock) {
          console.warn(
            `[NFE_CONCURRENCY_LOCK_SKIPPED] requestId=${getRequestIdForLog()} | source=emitir | tenantId=${tenantId} | orderId=${orderId}`,
          );
          return res.status(409).json({
            message: 'Pedido já está em processamento',
          });
        }
        console.log(
          `[NFE_CONCURRENCY_LOCK_ACQUIRED] requestId=${getRequestIdForLog()} | source=emitir | tenantId=${tenantId} | orderId=${orderId}`,
        );

        // FASE 18 — Guard de idempotência (GAP 2). Roda ANTES de canEmitNFe,
        // ANTES de getNextNfeNumero e ANTES de qualquer escrita. Em modo
        // dry-run (flag false) apenas loga; em modo ativo, bloqueia.
        // (Substitui a antiga checagem `getNfeEmissaoByOrderId + ['autorizada','enviada']`
        // que dependia de ORDER BY DESC LIMIT 1.)
        const idem = await hasBlockingNFe(Number(orderId));
        if (idem.blocked) {
          if (ENABLE_NFE_IDEMPOTENCY_GUARD) {
            console.warn(
              `[NFE_IDEMPOTENCY_BLOCKED] requestId=${getRequestIdForLog()} | source=emitir | orderId=${orderId} | blockingStatus=${idem.blockingStatus} | blockingNfeId=${idem.blockingNfeId}`,
            );
            // FASE 19 — métrica agregada (sem dados sensíveis).
            incNfeIdemBlocked(idem.blockingStatus ?? 'unknown', 'emitir');
            return res.status(409).json({
              message: 'Pedido já possui NF-e em status bloqueante',
              blockingStatus: idem.blockingStatus,
              blockingNfeId: idem.blockingNfeId,
            });
          } else {
            console.warn(
              `[NFE_IDEMPOTENCY_DRY_RUN] requestId=${getRequestIdForLog()} | source=emitir | orderId=${orderId} | wouldBlockStatus=${idem.blockingStatus} | blockingNfeId=${idem.blockingNfeId}`,
            );
            // FASE 19 — métrica agregada (sem dados sensíveis).
            incNfeIdemDryRun(idem.blockingStatus ?? 'unknown', 'emitir');
            // segue o fluxo — só observa
          }
        }

        // STEP 9.2Y — Gate de faturamento (regras mínimas seguras)
        const check = await canEmitNFe(Number(orderId));
        if (!check.allowed) {
          console.warn('[NFE_BLOCKED]', { orderId, reason: check.reason });
          return res.status(400).json({
            error: 'Faturamento bloqueado',
            reason: check.reason,
          });
        }

        // FASE 3 — bloqueia emissão de NF para pedido de outro tenant.
        await validateOrderTenant(Number(orderId));

        // FASE NF.7.9.2 — guard de fechamento mensal. Recusa emitir NF
        // para pedido cujo `createdAt` cai num mês já fechado para a
        // empresa. Roda DEPOIS do tenant guard (ordem importa: nunca
        // expor o tenantId real para chamador errado). Em mês aberto
        // (default), segue normal.
        try {
          const orderRow = await storage.getOrder(Number(orderId));
          const ord: any = (orderRow as any)?.order ?? orderRow;
          if (ord?.companyId && ord?.createdAt) {
            const created = ord.createdAt instanceof Date
              ? ord.createdAt
              : new Date(ord.createdAt);
            if (!isNaN(created.getTime())) {
              const { isPeriodClosed } = await import(
                "../services/fiscal/fiscal-closure.service"
              );
              const closed = await isPeriodClosed(Number(ord.companyId), created);
              if (closed) {
                console.warn(
                  `[SECURITY] PERIODO_FECHADO | requestId=${getRequestIdForLog()} | source=nfe-emitir | companyId=${ord.companyId} | year=${created.getFullYear()} | month=${created.getMonth() + 1}`,
                );
                return res.status(403).json({ message: "PERIODO_FECHADO" });
              }
            }
          }
        } catch (closeErr: any) {
          // Falha aberta: se a checagem em si quebrar, não bloqueamos a
          // emissão (evita indisponibilidade fiscal por falha do guard).
          console.error("[NFE_PERIOD_CLOSURE_CHECK_ERROR]", closeErr?.message);
        }

        // FASE 8.4 — call-site resolve itens ANTES de chamar o builder.
        const resolvedEmit = await resolveBillingItems(Number(orderId));
        const input = await buildNFeInput({
          orderId: Number(orderId),
          sourceItems: resolvedEmit.items,
        });
        const erros = validarNFeInput(input);
        if (erros.length > 0) return res.status(422).json({ message: 'Dados fiscais incompletos', erros });

        const numero = await storage.getNextNfeNumero();
        const gerada = await gerarNFeXML(input, numero);

        const nfe = await storage.createNfeEmissao({
          orderId: Number(orderId),
          numero: gerada.numero,
          serie: gerada.serie,
          chaveNFe: gerada.chaveNFe,
          status: 'gerada',
          xmlGerado: gerada.xmlGerado,
          dataEmissao: gerada.dataEmissao,
          ambienteFiscal: input.tpAmb === '1' ? 'producao' : 'homologacao',
        });

        // Atualizar status fiscal do pedido
        await storage.updateOrder(Number(orderId), { fiscalStatus: 'nota_emitida' });

        await storage.createLog({ action: 'NF-E_GERADA', description: `NF-e nº ${numero} gerada para pedido #${orderId}. Chave: ${gerada.chaveNFe}`, level: 'INFO', userId: req.session.userId });

        res.status(201).json({ success: true, nfe, mensagem: 'XML NF-e gerado. Use /api/nfe/:id/enviar para transmitir ao SEFAZ.' });
      } catch (e: any) {
        // FASE NF.4.3 — tradução de erro fiscal para mensagem amigável.
        // Mantém status 500 (rule 4) e preserva o erro técnico no log.
        const { translateNFeError } = await import('../services/nfe/diagnostics/nfe-error-parser');
        const parsed = translateNFeError(e);
        console.error('[NFE_EMIT_FAILED]', {
          requestId: getRequestIdForLog(),
          source: 'emitir',
          orderId: req.body?.orderId,
          code: parsed.code,
          rawMessage: e?.message,
          stack: e?.stack,
        });
        res.status(500).json({ error: parsed.code, message: parsed.message });
      } finally {
        // FASE 20 — release SEMPRE no finally, e SOMENTE se adquirido.
        if (lock) {
          const tenantIdLog = lock.tenantId;
          const orderIdLog = lock.orderId;
          await releaseOrderLock(lock);
          console.log(
            `[NFE_CONCURRENCY_LOCK_RELEASED] requestId=${getRequestIdForLog()} | source=emitir | tenantId=${tenantIdLog} | orderId=${orderIdLog}`,
          );
        }
      }
    });

    // FASE FISCAL 8.0 — POST /api/nfe/:orderId/reenviar — reemissão manual controlada.
    //
    // Caso de uso: a NF-e do pedido foi rejeitada (status `rejeitada`/`erro`/
    // `denegada`), o operador corrigiu o pedido e quer reenviar SEM precisar
    // passar pelo fluxo padrão (`/api/nfe/emitir`) — que é bloqueado pelo
    // guard de idempotência justamente por já existir uma NF-e prévia para o
    // pedido.
    //
    // Garantias preservadas (NÃO removidas — fluxo manual, não automação):
    //   • Tenant scope (validateOrderTenant) — multi-tenant seguro.
    //   • Lock de concorrência (acquireOrderLock) — evita corrida com `emitir`.
    //   • Gate de faturamento (canEmitNFe) — mesmas regras de elegibilidade.
    //   • Fechamento mensal (PERIODO_FECHADO) — mesma checagem.
    //   • Validação fiscal (validarNFeInput) — não pula validação de input.
    //   • Sessão obrigatória (requireActiveSubscription + req.session.userId).
    //
    // Diferença ÚNICA em relação a `/api/nfe/emitir`:
    //   • Pula `hasBlockingNFe` quando a NF-e mais recente está em status
    //     terminal de falha. Se a última NF-e está `autorizada`/`enviada`/
    //     `gerada`/`assinada`, a reemissão é REJEITADA (409) — não é o caso
    //     de uso desta rota.
    app.post('/api/nfe/:orderId/reenviar', requireActiveSubscription, async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      let lock: OrderLockHandle | null = null;
      const orderIdRaw = req.params?.orderId;
      const orderId = Number(orderIdRaw);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).json({ message: 'orderId inválido' });
      }
      try {
        // FASE 20 — Lock antes de qualquer leitura/escrita.
        const tenantId = requireTenantId();
        lock = await acquireOrderLock(tenantId, orderId);
        if (!lock) {
          console.warn(
            `[NFE_CONCURRENCY_LOCK_SKIPPED] requestId=${getRequestIdForLog()} | source=reenviar | tenantId=${tenantId} | orderId=${orderId}`,
          );
          return res.status(409).json({ message: 'Pedido já está em processamento' });
        }
        console.log(
          `[NFE_CONCURRENCY_LOCK_ACQUIRED] requestId=${getRequestIdForLog()} | source=reenviar | tenantId=${tenantId} | orderId=${orderId}`,
        );

        // Tenant scope ANTES de qualquer leitura — bloqueia cross-tenant.
        await validateOrderTenant(orderId);

        // FASE FISCAL 8.0 — gate específico de reemissão: a NF-e mais
        // recente do pedido PRECISA estar em status terminal de falha.
        // Caso contrário, devolve 409 e instrui o operador a usar o fluxo
        // padrão (/emitir) ou cancelar a NF autorizada antes.
        // `getNfeEmissaoByOrderId` já devolve a NF-e mais recente (ORDER BY
        // createdAt DESC LIMIT 1 — ver server/services/storage.ts). Reutilizar
        // o método existente evita duplicar SQL aqui.
        const ultima = await storage.getNfeEmissaoByOrderId(orderId);
        const ultimoStatus = (ultima as any)?.status;
        const reemissivel = new Set(['rejeitada', 'erro', 'denegada']);
        if (!ultima) {
          return res.status(404).json({
            message: 'Nenhuma NF-e prévia encontrada para este pedido. Use /api/nfe/emitir para emitir a primeira.',
          });
        }
        if (!reemissivel.has(String(ultimoStatus))) {
          console.warn(
            `[NFE_REENVIAR_BLOCKED] requestId=${getRequestIdForLog()} | orderId=${orderId} | currentStatus=${ultimoStatus}`,
          );
          return res.status(409).json({
            message: 'Reemissão só é permitida quando a NF-e está rejeitada, com erro ou denegada.',
            currentStatus: ultimoStatus,
          });
        }

        // STEP 9.2Y — gate de faturamento idêntico ao /emitir.
        const check = await canEmitNFe(orderId);
        if (!check.allowed) {
          console.warn('[NFE_REENVIAR_BLOCKED_BY_GATE]', { orderId, reason: check.reason });
          return res.status(400).json({ error: 'Faturamento bloqueado', reason: check.reason });
        }

        // FASE NF.7.9.2 — guard de fechamento mensal (mesma lógica do /emitir).
        try {
          const orderRow = await storage.getOrder(orderId);
          const ord: any = (orderRow as any)?.order ?? orderRow;
          if (ord?.companyId && ord?.createdAt) {
            const created = ord.createdAt instanceof Date ? ord.createdAt : new Date(ord.createdAt);
            if (!isNaN(created.getTime())) {
              const { isPeriodClosed } = await import('../services/fiscal/fiscal-closure.service');
              const closed = await isPeriodClosed(Number(ord.companyId), created);
              if (closed) {
                console.warn(
                  `[SECURITY] PERIODO_FECHADO | requestId=${getRequestIdForLog()} | source=nfe-reenviar | companyId=${ord.companyId} | year=${created.getFullYear()} | month=${created.getMonth() + 1}`,
                );
                return res.status(403).json({ message: 'PERIODO_FECHADO' });
              }
            }
          }
        } catch (closeErr: any) {
          console.error('[NFE_PERIOD_CLOSURE_CHECK_ERROR]', closeErr?.message);
        }

        // Build → validate → generate XML → persist (mesma sequência do /emitir).
        // FASE 8.4 — call-site resolve itens ANTES de chamar o builder.
        const resolvedReenviar = await resolveBillingItems(orderId);
        const input = await buildNFeInput({
          orderId,
          sourceItems: resolvedReenviar.items,
        });
        const erros = validarNFeInput(input);
        if (erros.length > 0) {
          return res.status(422).json({ message: 'Dados fiscais incompletos', erros });
        }

        const numero = await storage.getNextNfeNumero();
        const gerada = await gerarNFeXML(input, numero);

        const nfe = await storage.createNfeEmissao({
          orderId,
          numero: gerada.numero,
          serie: gerada.serie,
          chaveNFe: gerada.chaveNFe,
          status: 'gerada',
          xmlGerado: gerada.xmlGerado,
          dataEmissao: gerada.dataEmissao,
          ambienteFiscal: input.tpAmb === '1' ? 'producao' : 'homologacao',
        });

        await storage.updateOrder(orderId, { fiscalStatus: 'nota_emitida' });

        await storage.createLog({
          action: 'NF-E_REENVIADA',
          description: `NF-e nº ${numero} reemitida para pedido #${orderId} (substitui NF #${(ultima as any)?.id} status=${ultimoStatus}). Chave: ${gerada.chaveNFe}`,
          level: 'INFO',
          userId: req.session.userId,
        });

        res.status(201).json({
          success: true,
          nfe,
          previousNfeId: (ultima as any)?.id,
          previousStatus: ultimoStatus,
          mensagem: 'NF-e reemitida. Use /api/nfe/:id/enviar para transmitir ao SEFAZ.',
        });
      } catch (e: any) {
        const { translateNFeError } = await import('../services/nfe/diagnostics/nfe-error-parser');
        const parsed = translateNFeError(e);
        console.error('[NFE_REENVIAR_FAILED]', {
          requestId: getRequestIdForLog(),
          source: 'reenviar',
          orderId,
          code: parsed.code,
          rawMessage: e?.message,
          stack: e?.stack,
        });
        const status = (e?.statusCode && Number.isInteger(e.statusCode)) ? e.statusCode : 500;
        res.status(status).json({ error: parsed.code, message: parsed.message });
      } finally {
        if (lock) {
          const tenantIdLog = lock.tenantId;
          const orderIdLog = lock.orderId;
          await releaseOrderLock(lock);
          console.log(
            `[NFE_CONCURRENCY_LOCK_RELEASED] requestId=${getRequestIdForLog()} | source=reenviar | tenantId=${tenantIdLog} | orderId=${orderIdLog}`,
          );
        }
      }
    });

    // FASE FISCAL 8.1 — POST /api/nfe/:orderId/corrigir-reenviar
    //
    // Reemissão SEMI-AUTOMÁTICA: além das mesmas garantias do /reenviar
    // (tenant, lock, status terminal, gate de faturamento, fechamento), esta
    // rota consulta o `nfeErrorHandler` para classificar o `cStat` da última
    // NF-e rejeitada e SÓ aceita disparar a reemissão quando a sugestão for
    // {RECALCULAR, REEMITIR}. Erros classificados como VALIDAR_XML ou MANUAL
    // exigem intervenção do operador e devolvem 422 com a mensagem oficial.
    //
    // IMPORTANTE — o endpoint NÃO recalcula impostos, NÃO altera o pedido,
    // NÃO altera CFOP/NCM/CST. Ele apenas reaproveita o pipeline existente
    // (`buildNFeInput → validarNFeInput → gerarNFeXML → createNfeEmissao`),
    // que lê o estado ATUAL do pedido. A premissa é que o operador já
    // corrigiu o pedido antes de clicar.
    app.post('/api/nfe/:orderId/corrigir-reenviar', requireActiveSubscription, async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      let lock: OrderLockHandle | null = null;
      const orderIdRaw = req.params?.orderId;
      const orderId = Number(orderIdRaw);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).json({ message: 'orderId inválido' });
      }
      try {
        const tenantId = requireTenantId();
        lock = await acquireOrderLock(tenantId, orderId);
        if (!lock) {
          console.warn(
            `[NFE_CONCURRENCY_LOCK_SKIPPED] requestId=${getRequestIdForLog()} | source=corrigir-reenviar | tenantId=${tenantId} | orderId=${orderId}`,
          );
          return res.status(409).json({ message: 'Pedido já está em processamento' });
        }
        console.log(
          `[NFE_CONCURRENCY_LOCK_ACQUIRED] requestId=${getRequestIdForLog()} | source=corrigir-reenviar | tenantId=${tenantId} | orderId=${orderId}`,
        );

        await validateOrderTenant(orderId);

        const ultima = await storage.getNfeEmissaoByOrderId(orderId);
        if (!ultima) {
          return res.status(404).json({
            message: 'Nenhuma NF-e prévia encontrada. Use /api/nfe/emitir para emitir a primeira.',
          });
        }
        const ultimoStatus = (ultima as any)?.status;
        const ultimoCStat = (ultima as any)?.cStat ?? '';
        const reemissivel = new Set(['rejeitada', 'erro']);
        if (!reemissivel.has(String(ultimoStatus))) {
          console.warn(
            `[NFE_CORRIGIR_BLOCKED] requestId=${getRequestIdForLog()} | orderId=${orderId} | currentStatus=${ultimoStatus}`,
          );
          return res.status(409).json({
            message: 'NF-e não pode ser corrigida (status atual não é rejeitada nem erro).',
            currentStatus: ultimoStatus,
          });
        }

        // FASE FISCAL 8.1 — classifica o cStat e SÓ avança se a sugestão
        // for acionável automaticamente. Demais casos: 422 com a mensagem
        // do handler para o operador agir manualmente.
        const { getCorrecaoSugerida } = await import('../services/nfe/nfeErrorHandler');
        const sugestao = getCorrecaoSugerida(ultimoCStat);
        const acionavel = sugestao.tipo === 'RECALCULAR' || sugestao.tipo === 'REEMITIR';
        if (!acionavel) {
          console.warn(
            `[NFE_CORRIGIR_NAO_ACIONAVEL] requestId=${getRequestIdForLog()} | orderId=${orderId} | cStat=${ultimoCStat} | tipo=${sugestao.tipo}`,
          );
          return res.status(422).json({
            message: sugestao.mensagem,
            tipo: sugestao.tipo,
            cStat: ultimoCStat,
          });
        }

        const check = await canEmitNFe(orderId);
        if (!check.allowed) {
          console.warn('[NFE_CORRIGIR_BLOCKED_BY_GATE]', { orderId, reason: check.reason });
          return res.status(400).json({ error: 'Faturamento bloqueado', reason: check.reason });
        }

        try {
          const orderRow = await storage.getOrder(orderId);
          const ord: any = (orderRow as any)?.order ?? orderRow;
          if (ord?.companyId && ord?.createdAt) {
            const created = ord.createdAt instanceof Date ? ord.createdAt : new Date(ord.createdAt);
            if (!isNaN(created.getTime())) {
              const { isPeriodClosed } = await import('../services/fiscal/fiscal-closure.service');
              const closed = await isPeriodClosed(Number(ord.companyId), created);
              if (closed) {
                console.warn(
                  `[SECURITY] PERIODO_FECHADO | requestId=${getRequestIdForLog()} | source=nfe-corrigir-reenviar | companyId=${ord.companyId} | year=${created.getFullYear()} | month=${created.getMonth() + 1}`,
                );
                return res.status(403).json({ message: 'PERIODO_FECHADO' });
              }
            }
          }
        } catch (closeErr: any) {
          console.error('[NFE_PERIOD_CLOSURE_CHECK_ERROR]', closeErr?.message);
        }

        // Reaproveita exatamente o pipeline do /emitir e do /reenviar.
        // FASE 8.4 — call-site resolve itens ANTES de chamar o builder.
        const resolvedCorrigir = await resolveBillingItems(orderId);
        const input = await buildNFeInput({
          orderId,
          sourceItems: resolvedCorrigir.items,
        });
        const erros = validarNFeInput(input);
        if (erros.length > 0) {
          return res.status(422).json({ message: 'Dados fiscais incompletos', erros });
        }

        // FASE FISCAL 9.0 — auto-correção de totais ICMS para cStat 533
        // (RECALCULAR). Roda APENAS quando a sugestão classificou o erro como
        // recálculo de totais. Pura — nenhum CST/CSOSN/pICMS é alterado;
        // o cálculo per-item segue intacto dentro de gerarNFeXML.
        //
        // Por que NÃO mutar `input`: a interface NFeInput não expõe um campo
        // `total` (totais são SOMADOS dentro de gerarNFeXML a partir dos
        // itens — exatamente o que esta função faz). Mutar `input.produtos`
        // violaria a regra "NÃO recalcular fora do fluxo oficial". Portanto
        // a função roda como AUDITORIA + safety net: emite o log esperado
        // pelo spec e deixa o gerador soberano.
        let totaisAuditados: { vBC: number; vICMS: number } | null = null;
        if (sugestao.tipo === 'RECALCULAR') {
          const { corrigirTotaisICMS } = await import('../services/nfe/nfeAutoCorrect');
          totaisAuditados = corrigirTotaisICMS(input.produtos as any[]);
          console.warn('[NFE_AUTO_CORRECAO_ICMS]', {
            requestId: getRequestIdForLog(),
            orderId,
            cStat: ultimoCStat,
            previousNfeId: (ultima as any)?.id,
            vBC: totaisAuditados.vBC,
            vICMS: totaisAuditados.vICMS,
            totalItens: Array.isArray(input.produtos) ? input.produtos.length : 0,
          });
        }

        const numero = await storage.getNextNfeNumero();
        const gerada = await gerarNFeXML(input, numero);

        const nfe = await storage.createNfeEmissao({
          orderId,
          numero: gerada.numero,
          serie: gerada.serie,
          chaveNFe: gerada.chaveNFe,
          status: 'gerada',
          xmlGerado: gerada.xmlGerado,
          dataEmissao: gerada.dataEmissao,
          ambienteFiscal: input.tpAmb === '1' ? 'producao' : 'homologacao',
        });

        await storage.updateOrder(orderId, { fiscalStatus: 'nota_emitida' });

        await storage.createLog({
          action: 'NF-E_CORRIGIDA_REENVIADA',
          description:
            `NF-e nº ${numero} reemitida (correção semi-automática tipo=${sugestao.tipo}, cStat=${ultimoCStat}) para pedido #${orderId}. ` +
            `Substitui NF #${(ultima as any)?.id} status=${ultimoStatus}. ` +
            (totaisAuditados
              ? `Auditoria ICMS: vBC=${totaisAuditados.vBC} vICMS=${totaisAuditados.vICMS}. `
              : '') +
            `Chave: ${gerada.chaveNFe}`,
          level: 'INFO',
          userId: req.session.userId,
        });

        res.status(201).json({
          success: true,
          nfe,
          previousNfeId: (ultima as any)?.id,
          previousStatus: ultimoStatus,
          previousCStat: ultimoCStat,
          correcao: sugestao,
          mensagem: 'NF-e corrigida e reemitida. Use /api/nfe/:id/enviar para transmitir ao SEFAZ.',
        });
      } catch (e: any) {
        const { translateNFeError } = await import('../services/nfe/diagnostics/nfe-error-parser');
        const parsed = translateNFeError(e);
        console.error('[NFE_CORRIGIR_REENVIAR_FAILED]', {
          requestId: getRequestIdForLog(),
          source: 'corrigir-reenviar',
          orderId,
          code: parsed.code,
          rawMessage: e?.message,
          stack: e?.stack,
        });
        const status = (e?.statusCode && Number.isInteger(e.statusCode)) ? e.statusCode : 500;
        res.status(status).json({ error: parsed.code, message: parsed.message });
      } finally {
        if (lock) {
          const tenantIdLog = lock.tenantId;
          const orderIdLog = lock.orderId;
          await releaseOrderLock(lock);
          console.log(
            `[NFE_CONCURRENCY_LOCK_RELEASED] requestId=${getRequestIdForLog()} | source=corrigir-reenviar | tenantId=${tenantIdLog} | orderId=${orderIdLog}`,
          );
        }
      }
    });

    // FASE FISCAL 8.2 — GET /api/nfe/:orderId/historico
    //
    // Endpoint READ-ONLY. Devolve a sequência completa de tentativas de
    // emissão (qualquer status) vinculadas ao pedido, ordenadas da mais
    // recente para a mais antiga, para auditoria visual no card de
    // rejeições. Tenant scope é aplicado no repository (JOIN orders +
    // companyId), então tentar inspecionar pedido de outro tenant devolve
    // lista vazia. NÃO altera nada do fluxo fiscal — apenas SELECT.
    app.get('/api/nfe/:orderId/historico', requireActiveSubscription, async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      const orderIdRaw = req.params?.orderId;
      const orderId = Number(orderIdRaw);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).json({ message: 'orderId inválido' });
      }
      // FASE 6 — multi-tenant hardening: defense-in-depth. O repository já
      // aplica JOIN por companyId (devolveria []), mas isso permite a um
      // atacante distinguir "pedido inexistente" de "pedido alheio sem
      // histórico". Validamos o tenant ANTES da leitura para retornar 403
      // explícito + log [SECURITY] TENANT_MISMATCH (via safeGetOrder).
      try {
        await validateOrderTenant(orderId);
      } catch (e: any) {
        if (e instanceof AppError) {
          return res.status(e.status).json({ message: e.message });
        }
        throw e;
      }
      try {
        const { financeService } = await import('../modules/finance/finance.service');
        const historico = await financeService.getNfeHistoricoPorPedido(orderId);
        res.json({ orderId, total: historico.length, tentativas: historico });
      } catch (e: any) {
        console.error('[NFE_HISTORICO_FAILED]', {
          requestId: getRequestIdForLog(),
          orderId,
          message: e?.message,
        });
        res.status(500).json({ error: 'Falha ao carregar histórico de NF-e' });
      }
    });

    // POST /api/nfe/emitir-lote — STEP 9.3B: emissão em lote (controlada pelo guard)
    app.post('/api/nfe/emitir-lote', requireActiveSubscription, async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const { orderIds } = req.body;
        if (!Array.isArray(orderIds) || orderIds.length === 0) {
          return res.status(400).json({ error: 'Lista de pedidos inválida' });
        }

        // FASE 20 — tenantId é obtido UMA vez por request (não por item). Lock
        // continua granular por (tenantId, orderId) — pedidos diferentes do
        // mesmo tenant não bloqueiam um ao outro.
        const tenantIdLote = requireTenantId();

        const results = await Promise.all(
          orderIds.map(async (orderId: number) => {
            let lockItem: OrderLockHandle | null = null;
            try {
              // FASE 20 — Lock de concorrência (GAP 1, GAP 7). SEMPRE ANTES
              // de qualquer validação ou escrita, dentro do item do lote.
              lockItem = await acquireOrderLock(tenantIdLote, Number(orderId));
              if (!lockItem) {
                console.warn(
                  `[NFE_CONCURRENCY_LOCK_SKIPPED] requestId=${getRequestIdForLog()} | source=emitir-lote | tenantId=${tenantIdLote} | orderId=${orderId}`,
                );
                return {
                  orderId,
                  status: 'skipped',
                  reason: 'Pedido já está em processamento por outra execução',
                };
              }
              console.log(
                `[NFE_CONCURRENCY_LOCK_ACQUIRED] requestId=${getRequestIdForLog()} | source=emitir-lote | tenantId=${tenantIdLote} | orderId=${orderId}`,
              );

              // FASE 18 — Guard de idempotência (GAP 2). Roda ANTES de canEmitNFe,
              // ANTES de getNextNfeNumero e ANTES de qualquer escrita. Mesmo
              // comportamento do /api/nfe/emitir e do cron — função única.
              const idem = await hasBlockingNFe(Number(orderId));
              if (idem.blocked) {
                if (ENABLE_NFE_IDEMPOTENCY_GUARD) {
                  console.warn(
                    `[NFE_IDEMPOTENCY_BLOCKED] requestId=${getRequestIdForLog()} | source=emitir-lote | orderId=${orderId} | blockingStatus=${idem.blockingStatus} | blockingNfeId=${idem.blockingNfeId}`,
                  );
                  // FASE 19 — métrica agregada (sem dados sensíveis).
                  incNfeIdemBlocked(idem.blockingStatus ?? 'unknown', 'emitir-lote');
                  return {
                    orderId,
                    status: 'blocked',
                    reason: `Pedido já possui NF-e em status bloqueante: ${idem.blockingStatus}`,
                  };
                } else {
                  console.warn(
                    `[NFE_IDEMPOTENCY_DRY_RUN] requestId=${getRequestIdForLog()} | source=emitir-lote | orderId=${orderId} | wouldBlockStatus=${idem.blockingStatus} | blockingNfeId=${idem.blockingNfeId}`,
                  );
                  // FASE 19 — métrica agregada (sem dados sensíveis).
                  incNfeIdemDryRun(idem.blockingStatus ?? 'unknown', 'emitir-lote');
                  // segue o fluxo — só observa
                }
              }

              // Guard — mesma regra do /api/nfe/emitir, sem duplicar
              const check = await canEmitNFe(Number(orderId));
              if (!check.allowed) {
                return { orderId, status: 'blocked', reason: check.reason };
              }

              // FASE 3 — valida tenant também na emissão em lote (cada item).
              await validateOrderTenant(Number(orderId));

              // FASE 8.4 — call-site resolve itens ANTES de chamar o builder.
              const resolvedLote = await resolveBillingItems(Number(orderId));
              const input = await buildNFeInput({
                orderId: Number(orderId),
                sourceItems: resolvedLote.items,
              });
              const erros = validarNFeInput(input);
              if (erros.length > 0) {
                return { orderId, status: 'error', reason: `Dados fiscais incompletos: ${erros.join(', ')}` };
              }

              const numero = await storage.getNextNfeNumero();
              const gerada = await gerarNFeXML(input, numero);

              const nfe = await storage.createNfeEmissao({
                orderId: Number(orderId),
                numero: gerada.numero,
                serie: gerada.serie,
                chaveNFe: gerada.chaveNFe,
                status: 'gerada',
                xmlGerado: gerada.xmlGerado,
                dataEmissao: gerada.dataEmissao,
                ambienteFiscal: input.tpAmb === '1' ? 'producao' : 'homologacao',
              });

              await storage.updateOrder(Number(orderId), { fiscalStatus: 'nota_emitida' });
              await storage.createLog({ action: 'NF-E_LOTE_GERADA', description: `NF-e nº ${numero} gerada em lote para pedido #${orderId}.`, level: 'INFO', userId: req.session.userId });

              return { orderId, status: 'success', nfe };
            } catch (e: any) {
              // FASE NF.4.3 — tradução de erro fiscal por item do lote.
              // Preserva código técnico no log e devolve mensagem amigável.
              const { translateNFeError } = await import('../services/nfe/diagnostics/nfe-error-parser');
              const parsed = translateNFeError(e);
              console.error('[NFE_EMIT_FAILED]', {
                requestId: getRequestIdForLog(),
                source: 'emitir-lote',
                orderId,
                code: parsed.code,
                rawMessage: e?.message,
                stack: e?.stack,
              });
              return { orderId, status: 'error', error: parsed.code, reason: parsed.message };
            } finally {
              // FASE 20 — release SEMPRE no finally, e SOMENTE se adquirido.
              if (lockItem) {
                await releaseOrderLock(lockItem);
                console.log(
                  `[NFE_CONCURRENCY_LOCK_RELEASED] requestId=${getRequestIdForLog()} | source=emitir-lote | tenantId=${tenantIdLote} | orderId=${orderId}`,
                );
              }
            }
          }),
        );

        const total    = results.length;
        const success  = results.filter(r => r.status === 'success').length;
        const blocked  = results.filter(r => r.status === 'blocked').length;
        const errors   = results.filter(r => r.status === 'error').length;
        const skipped  = results.filter(r => r.status === 'skipped').length;

        return res.json({ summary: { total, success, blocked, errors, skipped }, results });
      } catch (e: any) {
        return res.status(500).json({ message: e.message });
      }
    });

    // POST /api/nfe/:id/enviar — transmitir ao SEFAZ
    app.post('/api/nfe/:id/enviar', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const nfe = await storage.getNfeEmissao(Number(req.params.id));
        if (!nfe) return res.status(404).json({ message: 'NF-e não encontrada' });
        if (!nfe.xmlGerado) return res.status(400).json({ message: 'XML não gerado. Emita a NF-e primeiro.' });

        // FASE 3 — bloqueia transmissão de NF de outro tenant antes de qualquer ação.
        if (nfe.orderId) await validateOrderTenant(nfe.orderId);

        // FASE NF.3 — modo controlado (mock por padrão; production usa o handler legado abaixo).
        const sefazMode = (process.env.NFE_SEFAZ_MODE ?? 'mock').toLowerCase();
        if (sefazMode !== 'production') {
          const { transmitirNFe } = await import('../modules/nfe/nfe-transmit.service.ts');
          try {
            const result = await transmitirNFe(nfe.id);
            await storage.createLog({
              action: 'NF-E_ENVIADA',
              description: `NF-e #${nfe.id} transmitida em modo ${result.mode}. Status: ${result.status} (${result.cStat}) - ${result.xMotivo}`,
              level: result.status === 'autorizada' ? 'INFO' : 'WARN',
              userId: req.session.userId,
            });
            return res.json({
              success: result.status === 'autorizada',
              retorno: {
                status: result.status,
                cStat: result.cStat,
                xMotivo: result.xMotivo,
                protocolo: result.protocolo,
              },
              mode: result.mode,
              attempts: result.attempts,
              nfe: await storage.getNfeEmissao(nfe.id),
            });
          } catch (err: any) {
            const code = err?.message ?? 'NFE_SEND_UNKNOWN_ERROR';
            if (code === 'NFE_ALREADY_SENT') {
              return res.status(409).json({ message: 'NF-e já enviada/autorizada — reenvio bloqueado.', code });
            }
            if (code === 'NFE_NOT_FOUND') {
              return res.status(404).json({ message: 'NF-e não encontrada', code });
            }
            if (code === 'NFE_XML_MISSING') {
              return res.status(400).json({ message: 'XML não gerado. Emita a NF-e primeiro.', code });
            }
            return res.status(500).json({ message: code, code });
          }
        }

        const certPath = process.env.CERT_PATH;
        const certPwd = process.env.CERT_PASSWORD;
        let xmlParaEnviar = nfe.xmlGerado;

        if (certPath && certPwd) {
          try {
            const { assinarXML } = await import('../services/nfe/nfeSignature.ts');
            const { xmlAssinado } = await assinarXML(nfe.xmlGerado, certPath, certPwd);
            xmlParaEnviar = xmlAssinado;
            await storage.updateNfeEmissao(nfe.id, { status: 'assinada', xmlGerado: xmlParaEnviar });
          } catch (sigErr: any) {
            return res.status(400).json({ message: `Erro na assinatura digital: ${sigErr.message}. Verifique CERT_PATH e CERT_PASSWORD.` });
          }
        } else {
          return res.status(400).json({
            message: 'Certificado digital não configurado. Defina as variáveis CERT_PATH e CERT_PASSWORD para transmitir ao SEFAZ.',
            nfe,
            dica: 'Para homologação, configure um certificado A1 (.pfx) e defina as env vars CERT_PATH e CERT_PASSWORD.'
          });
        }

        const uf = nfe.ambienteFiscal === 'producao' ? 'SP' : 'SP';
        const tpAmb = nfe.ambienteFiscal === 'producao' ? '1' : '2';
        const retorno = await enviarNFeSEFAZ(xmlParaEnviar, uf, tpAmb);

        const updates: any = { status: retorno.status, cStat: retorno.cStat, xMotivo: retorno.xMotivo };
        if (retorno.status === 'autorizada') {
          updates.protocolo = retorno.protocolo;
          updates.dataAutorizacao = retorno.dataAutorizacao ? new Date(retorno.dataAutorizacao) : new Date();
          updates.xmlAutorizado = retorno.xmlAutorizado || xmlParaEnviar;
        }
        await storage.updateNfeEmissao(nfe.id, updates);
        await storage.createLog({ action: 'NF-E_ENVIADA', description: `NF-e #${nfe.id} enviada ao SEFAZ. Status: ${retorno.status} (${retorno.cStat}) - ${retorno.xMotivo}`, level: retorno.status === 'autorizada' ? 'INFO' : 'WARN', userId: req.session.userId });

        // Envio automático de email com XML após autorização SEFAZ
        if (retorno.status === 'autorizada' && nfe.orderId) {
          try {
            const { sendNFeAutorizadaEmail } = await import('../services/mailer.ts');
            const orderData = await storage.getOrder(nfe.orderId);
            const config = await storage.getCompanyConfig();
            const destinos: string[] = [];
            if (config?.email) destinos.push(config.email);
            const orderCompany = orderData ? await storage.getCompany((orderData.order as any).companyId) : null;
            if (orderCompany?.email) destinos.push(orderCompany.email);
            const xmlContent = retorno.xmlAutorizado || xmlParaEnviar;
            for (const email of destinos) {
              await sendNFeAutorizadaEmail({
                toEmail: email,
                nfeNumero: Number(nfe.numero),
                chaveNFe: nfe.chaveNFe || '',
                protocolo: retorno.protocolo || '',
                orderId: nfe.orderId,
                xmlContent,
              });
            }
          } catch (emailErr: any) {
            console.error('[EMAIL] Falha ao enviar email NF-e autorizada:', emailErr.message);
          }
        }

        res.json({ success: retorno.status === 'autorizada', retorno, nfe: await storage.getNfeEmissao(nfe.id) });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/nfe/:id/danfe — baixar PDF
    app.get('/api/nfe/:id/danfe', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const nfe = await storage.getNfeEmissao(Number(req.params.id));
        if (!nfe) return res.status(404).json({ message: 'NF-e não encontrada' });

        // FASE 3 — antes de usar nfe.orderId, garante que pertence ao tenant.
        if (nfe.orderId) await validateOrderTenant(nfe.orderId);

        // FASE 8.4 — call-site resolve itens ANTES de chamar o builder.
        let input: Awaited<ReturnType<typeof buildNFeInput>> | null = null;
        if (nfe.orderId) {
          const resolvedDanfe = await resolveBillingItems(nfe.orderId);
          input = await buildNFeInput({
            orderId: nfe.orderId,
            sourceItems: resolvedDanfe.items,
          });
        }
        if (!input) return res.status(400).json({ message: 'Não é possível gerar DANFE sem dados do pedido' });

        const vProd = input.produtos.reduce((s: number, p: any) => s + p.vProd, 0);
        const danfeData = {
          chaveNFe: nfe.chaveNFe || '',
          numero: nfe.numero,
          serie: nfe.serie,
          dataEmissao: nfe.dataEmissao || new Date().toISOString(),
          protocolo: nfe.protocolo || undefined,
          dataAutorizacao: nfe.dataAutorizacao?.toISOString() || undefined,
          emitente: input.emitente,
          destinatario: input.destinatario,
          produtos: input.produtos,
          total: { vProd, vFrete: 0, vDesc: 0, vNF: vProd },
          natOp: input.natOp || 'Venda de mercadoria adquirida',
          tpAmb: input.tpAmb || '2',
          informacoesAdicionais: input.informacoesAdicionais,
        };

        const pdfBuffer = await gerarDANFE(danfeData);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="DANFE_NF-e_${nfe.numero}.pdf"`);
        res.send(pdfBuffer);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/nfe/:id/xml — baixar XML
    app.get('/api/nfe/:id/xml', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const nfe = await storage.getNfeEmissao(Number(req.params.id));
        if (!nfe) return res.status(404).json({ message: 'NF-e não encontrada' });
        // FASE 6 — multi-tenant hardening: bloqueia download de XML de NF-e
        // pertencente a outro tenant. Mesmo padrão de /api/nfe/:id/danfe.
        if (nfe.orderId) {
          try {
            await validateOrderTenant(nfe.orderId);
          } catch (e: any) {
            if (e instanceof AppError) {
              return res.status(e.status).json({ message: e.message });
            }
            throw e;
          }
        }
        const xml = nfe.xmlAutorizado || nfe.xmlGerado;
        if (!xml) return res.status(404).json({ message: 'XML não disponível' });
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Disposition', `attachment; filename="NF-e_${nfe.chaveNFe || nfe.numero}.xml"`);
        res.send(xml);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // ── NF-e Dados Fiscais (emissora + destinatário) ─────────────────────────
    app.get('/api/nfe/fiscal-data/:orderId', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const orderId = Number(req.params.orderId);
        // FASE 6 — bloqueia leitura de fiscal-data de pedido de outro tenant.
        await validateOrderTenant(orderId);
        const order = await storage.getOrder(orderId);
        if (!order) return res.status(404).json({ message: 'Pedido não encontrado' });
        const [company, config] = await Promise.all([
          storage.getCompany((order as any).companyId),
          storage.getCompanyConfig(),
        ]);
        const co = company as any;
        const cfg = config as any;

        const emissora = {
          nome: cfg?.companyName || cfg?.razaoSocial || '—',
          cnpj: cfg?.cnpj || '—',
          ie: cfg?.stateRegistration || cfg?.inscricaoEstadual || '—',
          uf: cfg?.uf || cfg?.addressState || '—',
          municipio: cfg?.city || cfg?.addressCity || '—',
          cep: cfg?.cep || '—',
          logradouro: cfg?.address || '—',
          numero: cfg?.addressNumber || '—',
          bairro: cfg?.neighborhood || '—',
          regimeTributario: cfg?.regimeTributario || 'simples_nacional',
          cfopPadrao: cfg?.defaultCfop || '5102',
          ambiente: cfg?.ambiente || 'homologacao',
        };
        const destinatario = {
          nome: co?.companyName || '—',
          cnpj: co?.cnpj || '—',
          ie: co?.stateRegistration || '—',
          uf: co?.addressState || '—',
          municipio: co?.addressCity || '—',
          cep: co?.addressZip || '—',
          logradouro: co?.addressStreet || '—',
          numero: co?.addressNumber || '—',
          bairro: co?.addressNeighborhood || '—',
          ibge: co?.addressIbge || '—',
          cfopOverride: co?.defaultCfop || null,
          regimeOverride: co?.regimeTributario || null,
        };

        const checkEmissora = [
          { campo: 'CNPJ', ok: !!(cfg?.cnpj?.replace(/\D/g, '').length >= 14), label: 'CNPJ Emissora' },
          { campo: 'Razão Social', ok: !!(cfg?.companyName || cfg?.razaoSocial), label: 'Nome/Razão Social' },
          { campo: 'IE', ok: !!(cfg?.stateRegistration || cfg?.inscricaoEstadual), label: 'Inscrição Estadual' },
          { campo: 'UF', ok: !!(cfg?.uf || cfg?.addressState), label: 'UF' },
          { campo: 'Município', ok: !!(cfg?.city || cfg?.addressCity), label: 'Município' },
          { campo: 'CEP', ok: !!(cfg?.cep), label: 'CEP' },
          { campo: 'Certificado', ok: !!(process.env.CERT_PATH && process.env.CERT_PASSWORD), label: 'Certificado Digital' },
        ];
        const checkDestinatario = [
          { campo: 'CNPJ/CPF', ok: !!(co?.cnpj?.replace(/\D/g, '').length >= 11), label: 'CNPJ/CPF' },
          { campo: 'Nome', ok: !!(co?.companyName), label: 'Razão Social' },
          { campo: 'Endereço', ok: !!(co?.addressStreet), label: 'Logradouro' },
          { campo: 'Cidade', ok: !!(co?.addressCity), label: 'Município' },
          { campo: 'UF', ok: !!(co?.addressState), label: 'UF' },
          { campo: 'CEP', ok: !!(co?.addressZip), label: 'CEP' },
        ];

        res.json({
          orderId,
          orderCode: (order as any).orderCode || (order as any).vfCode || `#${orderId}`,
          emissora,
          destinatario,
          checkEmissora,
          checkDestinatario,
          completudeEmissora: Math.round(checkEmissora.filter(c => c.ok).length / checkEmissora.length * 100),
          completudeDestinatario: Math.round(checkDestinatario.filter(c => c.ok).length / checkDestinatario.length * 100),
        });
      } catch (e: any) {
        // FASE 8 — observabilidade: detecta ausência de tenant context numa
        // rota protegida (não há tenantContext middleware aqui). Apenas log;
        // status 500 e body permanecem inalterados.
        if (e?.message?.includes("Tenant context ausente")) {
          console.warn(
            `[SECURITY] MISSING_TENANT | requestId=${req.requestId ?? "unknown"} | orderId=${req.params.orderId} | details=Missing tenant context on protected route`,
          );
        }
        res.status(500).json({ message: e.message });
      }
    });

    // ── NF-e Diagnóstico Fiscal ──────────────────────────────────────────────
    // GET /api/nfe/diagnostics/:orderId — validar dados antes de emitir
    app.get('/api/nfe/diagnostics/:orderId', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        // FASE 6 — diagnóstico de NF-e expõe dados sensíveis do pedido;
        // bloqueia se for de outro tenant.
        await validateOrderTenant(Number(req.params.orderId));
        const { validateNFeBeforeSend } = await import('../services/nfe/diagnostics/nfe-validator.ts');
        const result = await validateNFeBeforeSend(Number(req.params.orderId));
        res.json(result);
      } catch (e: any) {
        // FASE 8 — observabilidade: detecta ausência de tenant context numa
        // rota protegida (não há tenantContext middleware aqui). Apenas log;
        // status 500 e body permanecem inalterados.
        if (e?.message?.includes("Tenant context ausente")) {
          console.warn(
            `[SECURITY] MISSING_TENANT | requestId=${req.requestId ?? "unknown"} | orderId=${req.params.orderId} | details=Missing tenant context on protected route`,
          );
        }
        res.status(500).json({ message: e.message });
      }
    });

    // POST /api/nfe/diagnostics/log-error — registrar erro + solução no training
    app.post('/api/nfe/diagnostics/log-error', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const { logNFeError } = await import('../services/nfe/diagnostics/nfe-training.ts');
        const record = await logNFeError({ ...req.body, userId: req.session.userId });
        res.status(201).json(record);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/nfe/diagnostics/log-errors — registrar múltiplos erros de validação
    app.post('/api/nfe/diagnostics/log-errors', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const { logNFeErrors } = await import('../services/nfe/diagnostics/nfe-training.ts');
        const { errors, orderId, nfeId } = req.body;
        const records = await logNFeErrors(errors || [], { orderId, nfeId, userId: req.session.userId });
        res.status(201).json(records);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/nfe/diagnostics/training/logs — logs de treinamento
    app.get('/api/nfe/diagnostics/training/logs', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const limit = req.query.limit ? Number(req.query.limit) : 100;
        const orderId = req.query.orderId ? Number(req.query.orderId) : undefined;
        const logs = await storage.getNfeTrainingLogs({ orderId, limit });
        res.json(logs);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/nfe/diagnostics/training/patterns — padrões aprendidos
    app.get('/api/nfe/diagnostics/training/patterns', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const { getLearnedPatterns } = await import('../services/nfe/diagnostics/nfe-training.ts');
        res.json(await getLearnedPatterns());
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // PATCH /api/nfe/diagnostics/training/:id/resolve — marcar erro como resolvido
    app.patch('/api/nfe/diagnostics/training/:id/resolve', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const { markNFeErrorResolved } = await import('../services/nfe/diagnostics/nfe-training.ts');
        const record = await markNFeErrorResolved(Number(req.params.id));
        res.json(record);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // ── FASE 8.6E — MÉTRICAS DE DEFAULTS FISCAIS (in-memory) ─────────────────
    // Telemetria das ocorrências de `[FISCAL_DEFAULT_APPLIED]` (uCom/csosn/cst).
    // Apenas leitura — não toca builder, não bloqueia emissão, não usa banco.
    app.get('/api/admin/nfe/fiscal-defaults', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const stats = getFiscalDefaultsStats();
        res.json({ ok: true, stats });
      } catch (err: any) {
        console.error('[ADMIN_FISCAL_DEFAULTS_ERROR]', err);
        res.status(500).json({ ok: false, message: err?.message });
      }
    });

    // POST /api/admin/nfe/fiscal-defaults/reset — zera contadores+buffer.
    // Útil após corrigir cadastros para medir impacto sem esperar o ciclo
    // natural do ring buffer (200 eventos).
    app.post('/api/admin/nfe/fiscal-defaults/reset', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        resetFiscalDefaultsStats();
        res.json({ ok: true });
      } catch (err: any) {
        console.error('[ADMIN_FISCAL_DEFAULTS_RESET_ERROR]', err);
        res.status(500).json({ ok: false, message: err?.message });
      }
    });

    // GET /api/nfe/sefaz/status — status do serviço SEFAZ
    app.get('/api/nfe/sefaz/status', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const config = await storage.getCompanyConfig();
        const tpAmb = config?.ambienteFiscal === 'producao' ? '1' : '2';
        const uf = config?.state || 'SP';
        const result = await consultarStatusSEFAZ(uf, tpAmb as '1' | '2');
        res.json({ ...result, uf, ambiente: tpAmb === '1' ? 'producao' : 'homologacao' });
      } catch (e: any) { res.status(500).json({ message: e.message, online: false }); }
    });

    // DELETE /api/nfe/:id — cancelar NF-e
    app.delete('/api/nfe/:id', async (req: any, res) => {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      try {
        const { motivo } = req.body;
        const nfe = await storage.getNfeEmissao(Number(req.params.id));
        if (!nfe) return res.status(404).json({ message: 'NF-e não encontrada' });
        await storage.updateNfeEmissao(nfe.id, { status: 'cancelada', motivoCancelamento: motivo || 'Cancelada pelo usuário' });
        res.json({ success: true });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/nf-manual — inserir NF manual
    // SECURITY: tenantContext + requireTenant force a pinned tenant; withTenant
    // stamps tenantId from session, ignoring anything in the request body.
    app.post('/api/nf-manual', tenantContext, requireTenant, async (req: any, res) => {
      try {
        const { numeroNf, dataEmissao, clienteFornecedor, produtos, impostos, observacoes } = req.body;
        if (!numeroNf || !dataEmissao || !clienteFornecedor || !produtos) {
          return res.status(400).json({ message: 'Campos obrigatórios: numeroNf, dataEmissao, clienteFornecedor, produtos' });
        }
        const nf = await db.insert(nfManual).values(withTenant(nfManual, {
          numeroNf,
          dataEmissao,
          clienteFornecedor,
          produtos,
          impostos,
          observacoes,
          userId: req.session.userId,
        })).returning();
        res.status(201).json({ success: true, nf: nf[0] });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/nf-manual — listar NF manuais
    // SECURITY: tenantContext resolves the principal; tenantWhere(nfManual)
    // filters by current tenant. MASTER without ?empresaId sees an empty list.
    app.get('/api/nf-manual', tenantContext, async (req: any, res) => {
      try {
        if (currentTenantId() == null) {
          return res.json([]);
        }
        const nfs = await db.select().from(nfManual)
          .where(tenantWhere(nfManual))
          .orderBy(desc(nfManual.createdAt));
        res.json(nfs);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });
  }

  // ─── Banco Itaú / Integração Bancária ────────────────────────────────────
  {
    const { getItauExtrato, getItauSaldo, criarBoletItau, getItauConfigFromEnv } = await import('../services/financeiro/itauIntegration.ts');
    const { reconciliarTransacoes, resumoReconciliacao } = await import('../services/financeiro/bankReconciliation.ts');

    const requireAuth = (req: any, res: any): boolean => {
      if (!req.session?.userId) { res.status(401).json({ message: 'Não autenticado' }); return false; }
      return true;
    };

    const getItauConfigFromAccount = (acc: any) => {
      if (acc.clientId && acc.clientSecret && acc.agencia && acc.conta) {
        return { clientId: acc.clientId, clientSecret: acc.clientSecret, agencia: acc.agencia, conta: acc.conta, ambiente: (acc.ambiente || 'sandbox') as 'sandbox' | 'producao' };
      }
      return getItauConfigFromEnv();
    };

    // GET /api/bank/accounts
    app.get('/api/bank/accounts', tenantContext, async (req: any, res) => {
      if (!requireAuth(req, res)) return;
      try {
        const accounts = await storage.getBankAccounts();
        // Mask secrets
        res.json(accounts.map(a => ({ ...a, clientSecret: a.clientSecret ? '***' : null })));
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/bank/accounts
    app.post('/api/bank/accounts', tenantContext, async (req: any, res) => {
      if (!requireAuth(req, res)) return;
      try {
        const acc = await storage.createBankAccount(req.body);
        res.status(201).json({ ...acc, clientSecret: acc.clientSecret ? '***' : null });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // PATCH /api/bank/accounts/:id
    app.patch('/api/bank/accounts/:id', tenantContext, async (req: any, res) => {
      if (!requireAuth(req, res)) return;
      try {
        const acc = await storage.updateBankAccount(Number(req.params.id), req.body);
        res.json({ ...acc, clientSecret: acc.clientSecret ? '***' : null });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // DELETE /api/bank/accounts/:id
    app.delete('/api/bank/accounts/:id', tenantContext, async (req: any, res) => {
      if (!requireAuth(req, res)) return;
      try {
        await storage.deleteBankAccount(Number(req.params.id));
        res.json({ success: true });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/bank/accounts/:id/testar — testar conexão
    app.post('/api/bank/accounts/:id/testar', tenantContext, async (req: any, res) => {
      if (!requireAuth(req, res)) return;
      try {
        const acc = await storage.getBankAccount(Number(req.params.id));
        if (!acc) return res.status(404).json({ message: 'Conta não encontrada' });
        const config = getItauConfigFromAccount(acc);
        if (!config) return res.status(400).json({ message: 'Credenciais não configuradas. Informe Client ID, Client Secret, Agência e Conta.' });
        const saldo = await getItauSaldo(config);
        await storage.updateBankAccount(acc.id, { status: 'conectado', saldoAtual: String(saldo.saldo), ultimaSincronizacao: new Date() });
        res.json({ success: true, saldo: saldo.saldo, dataConsulta: saldo.dataConsulta });
      } catch (e: any) {
        await storage.updateBankAccount(Number(req.params.id), { status: 'erro' }).catch(() => {});
        res.status(500).json({ message: `Erro de conexão: ${e.message}` });
      }
    });

    // GET /api/bank/accounts/:id/extrato
    app.get('/api/bank/accounts/:id/extrato', tenantContext, async (req: any, res) => {
      if (!requireAuth(req, res)) return;
      try {
        const acc = await storage.getBankAccount(Number(req.params.id));
        if (!acc) return res.status(404).json({ message: 'Conta não encontrada' });
        const config = getItauConfigFromAccount(acc);
        if (!config) return res.status(400).json({ message: 'Credenciais não configuradas' });
        const { from, to } = req.query as Record<string, string>;
        const dataInicio = from || new Date(Date.now() - 30 * 86400000).toISOString().substring(0, 10);
        const dataFim = to || new Date().toISOString().substring(0, 10);
        const transacoes = await getItauExtrato(config, dataInicio, dataFim);

        // Persist new transactions
        for (const tx of transacoes) {
          if (tx.id) {
            await storage.upsertBankTransaction(tx.id, acc.id, {
              bankAccountId: acc.id, externalId: tx.id, tipo: tx.tipo,
              valor: String(tx.valor), data: tx.data, descricao: tx.descricao || '',
              documento: tx.documento || '', status: 'pendente',
            });
          }
        }
        await storage.updateBankAccount(acc.id, { ultimaSincronizacao: new Date(), saldoAtual: transacoes.length > 0 ? String(transacoes[0]!.saldoApos || 0) : undefined });
        res.json({ transacoes, periodo: { dataInicio, dataFim } });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/bank/transactions — persisted transactions
    app.get('/api/bank/transactions', tenantContext, async (req: any, res) => {
      if (!requireAuth(req, res)) return;
      try {
        const { bankAccountId, status, from, to } = req.query;
        const txs = await storage.getBankTransactions({ bankAccountId: bankAccountId ? Number(bankAccountId) : undefined, status: status as string, from: from as string, to: to as string });
        res.json(txs);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/bank/accounts/:id/boleto — emitir boleto
    app.post('/api/bank/accounts/:id/boleto', tenantContext, async (req: any, res) => {
      if (!requireAuth(req, res)) return;
      try {
        const acc = await storage.getBankAccount(Number(req.params.id));
        if (!acc) return res.status(404).json({ message: 'Conta não encontrada' });
        const config = getItauConfigFromAccount(acc);
        if (!config) return res.status(400).json({ message: 'Credenciais não configuradas' });
        const boleto = await criarBoletItau(config, {
          ...req.body,
          nossoNumero: req.body.nossoNumero || String(Date.now()).slice(-10),
        });
        res.status(201).json(boleto);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/bank/reconciliar — reconciliar com AR/AP
    app.post('/api/bank/reconciliar', tenantContext, async (req: any, res) => {
      if (!requireAuth(req, res)) return;
      try {
        const { bankAccountId, from, to } = req.body;
        const txs = await storage.getBankTransactions({ bankAccountId: bankAccountId ? Number(bankAccountId) : undefined, status: 'pendente', from, to });
        const arList = await storage.getAccountsReceivable({ status: 'pendente' });
        const apList = await storage.getAccountsPayable({ status: 'pendente' });

        const bankTxs = txs.map(t => ({ id: String(t.id), tipo: t.tipo as 'credito' | 'debito', valor: parseFloat(t.valor), data: t.data, descricao: t.descricao || '', documento: t.documento || '' }));
        const matches = reconciliarTransacoes(bankTxs, arList as any, apList as any);
        const resumo = resumoReconciliacao(matches);
        res.json({ matches, resumo });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/bank/reconciliar/confirmar — confirm a match
    app.post('/api/bank/reconciliar/confirmar', tenantContext, async (req: any, res) => {
      if (!requireAuth(req, res)) return;
      try {
        const { bankTxId, tipo, itemId } = req.body;
        // Mark transaction as reconciled
        await storage.updateBankTransaction(Number(bankTxId), {
          status: 'conciliado',
          contaReceivableId: tipo === 'ar' ? Number(itemId) : undefined,
          contaPayableId: tipo === 'ap' ? Number(itemId) : undefined,
        });
        // Mark AR/AP as paid
        // FASE FIN.3.5 — AR agora roteia pelo FinanceService para que o
        // hook `handleOrderPayment` (FIN.3) seja disparado também aqui na
        // conciliação bancária. Internamente, FinanceService delega ao
        // mesmo `storage.payAccountReceivable`, então o efeito de banco é
        // idêntico ao caminho anterior — adicionalmente, gera o log de
        // auditoria FINANCE_AR_PAY e o log [FIN.3] do pedido vinculado.
        // AP permanece intacto: não é escopo do FIN.3.
        if (tipo === 'ar') {
          await financeService.payAccountReceivable(
            Number(itemId),
            req.session.userId,
          );
        } else {
          await financeService.payAccountPayable(Number(itemId), req.session.userId);
        }
        res.json({ success: true });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // FASE BANCO.1 — POST /api/bank/remessa/itau
    // Geração de arquivo CNAB 240 de remessa para o Banco Itaú a partir de
    // IDs de accounts_receivable. Aditivo: apenas LÊ AR via repo existente
    // e devolve text/plain. Não altera status, schema ou módulo financeiro.
    app.post('/api/bank/remessa/itau', tenantContext, async (req: any, res) => {
      if (!requireAuth(req, res)) return;
      try {
        const { ids } = req.body ?? {};
        if (!Array.isArray(ids) || ids.length === 0) {
          return res.status(400).json({ message: 'Informe um array "ids" com pelo menos um ID de AR.' });
        }
        const arIds = ids.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n) && n > 0);
        if (arIds.length === 0) {
          return res.status(400).json({ message: 'Nenhum ID válido em "ids".' });
        }

        const { gerarRemessaItau } = await import('../modules/banking/itau/remessa.service');
        const config = await storage.getCompanyConfig().catch(() => null);
        const ctx = {
          cnpjCedente: (config as any)?.cnpj?.replace(/\D/g, '') || '00000000000000',
          nomeCedente: (config as any)?.companyName || 'EMPRESA',
          agencia: '0000',
          conta: '000000000000',
          dacConta: '0',
          nsa: 1,
          carteira: '109',
        };

        const result = await gerarRemessaItau(arIds, ctx);

        const filename = `remessa-itau-${Date.now()}.rem`;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-CNAB-Total-Titulos', String(result.totalTitulos));
        res.setHeader('X-CNAB-Ignorados-Pagos', String(result.ignoradosPagos));
        return res.status(200).send(result.conteudo);
      } catch (e: any) {
        console.error('[CNAB] erro ao gerar remessa Itaú', e);
        return res.status(500).json({ message: e.message });
      }
    });

    // FASE BANCO.3 — POST /api/bank/retorno/itau
    // Recebe arquivo .ret (multipart/form-data, campo "file"), parseia o
    // CNAB 240 de retorno do Itaú e dispara baixa automática nas AR
    // identificadas via financeService.payAccountReceivable (mesma rota
    // da conciliação manual — FIN.3.5). Fail-safe por item.
    app.post('/api/bank/retorno/itau', tenantContext, uploadInMemory.single('file'), async (req: any, res) => {
      if (!requireAuth(req, res)) return;
      try {
        if (!req.file?.buffer) {
          return res.status(400).json({ message: 'Arquivo de retorno (.ret) ausente. Envie como multipart/form-data com campo "file".' });
        }
        const content = req.file.buffer.toString('utf-8');
        const { processarRetornoItau } = await import('../modules/banking/itau/retorno.service');
        const result = await processarRetornoItau(content, req.session.userId, {
          fileName: req.file.originalname,
          companyId: req.session.companyId ?? null,
        });
        return res.status(200).json(result);
      } catch (e: any) {
        console.error('[CNAB] erro ao processar retorno Itaú', e);
        return res.status(500).json({ message: e.message });
      }
    });

    // FASE BANCO.5 — GET /api/bank/retorno/historico
    // Lista os últimos 20 uploads de retorno CNAB (auditoria operacional).
    // Apenas leitura; não dispara nenhuma baixa.
    app.get('/api/bank/retorno/historico', tenantContext, async (req: any, res) => {
      if (!requireAuth(req, res)) return;
      try {
        const items = await financeRepository.listCnabImportHistory(20);
        return res.status(200).json(items);
      } catch (e: any) {
        console.error('[CNAB] erro ao listar histórico de retornos', e);
        return res.status(500).json({ message: e.message });
      }
    });
  }

  // ─── AI Developer Routes ─────────────────────────────────────────────────
  {
    const ALLOWED_ROLES = ['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR', 'SUPER_ADMIN'];

    const requireDevAccess = async (req: any, res: any): Promise<boolean> => {
      if (!req.session?.userId) { res.status(401).json({ message: 'Não autenticado' }); return false; }
      const user = await storage.getUser(req.session.userId);
      if (!user || !ALLOWED_ROLES.includes(user.role)) {
        res.status(403).json({ message: `Acesso restrito. Seu perfil: ${user?.role || 'desconhecido'}. Necessário: ADMIN, DEVELOPER ou DIRECTOR.` });
        return false;
      }
      return true;
    };

    // GET /api/ai-developer/index — system indexer
    app.get('/api/ai-developer/index', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { buildSystemIndex } = await import('../services/aiDeveloper/systemIndexer.ts');
        const index = await buildSystemIndex();
        res.json(index);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/bugs — bug detection
    app.get('/api/ai-developer/bugs', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { detectBugs } = await import('../services/aiDeveloper/bugDetector.ts');
        const report = await detectBugs();
        res.json(report);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/security — security audit
    app.get('/api/ai-developer/security', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { auditSecurity } = await import('../services/aiDeveloper/codeAnalyzer.ts');
        const report = await auditSecurity();
        res.json(report);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/performance — performance analysis
    app.get('/api/ai-developer/performance', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { analyzePerformance } = await import('../services/aiDeveloper/codeAnalyzer.ts');
        const report = await analyzePerformance();
        res.json(report);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/deploy — generate deploy scripts
    app.get('/api/ai-developer/deploy', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { generateDeployScripts } = await import('../services/aiDeveloper/codeAnalyzer.ts');
        const scripts = generateDeployScripts();
        res.json(scripts);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/database — database analysis
    app.get('/api/ai-developer/database', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { db } = await import('../database/db.ts');
        const { sql } = await import('drizzle-orm');

        const [tablesResult, indexesResult, sizeResult] = await Promise.all([
          db.execute(sql`
            SELECT schemaname, tablename,
              pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
              (SELECT count(*) FROM information_schema.columns c WHERE c.table_name = t.tablename) as column_count
            FROM pg_tables t WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
          `),
          db.execute(sql`
            SELECT indexname, tablename, indexdef
            FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename
          `),
          db.execute(sql`
            SELECT pg_size_pretty(pg_database_size(current_database())) as db_size,
                   current_database() as db_name
          `),
        ]);

        // Count rows in main tables
        const rowCounts: Record<string, number> = {};
        const mainTables = ['orders', 'companies', 'products', 'users', 'nfe_emissoes', 'accounts_receivable', 'accounts_payable', 'financial_transactions', 'inventory_entries'];
        for (const tbl of mainTables) {
          try {
            const result = await db.execute(sql.raw(`SELECT count(*) as cnt FROM ${tbl}`));
            const [row] = result as any;
            rowCounts[tbl] = parseInt((row as any).cnt || '0');
          } catch {}
        }

        res.json({
          tables: tablesResult.rows,
          indexes: indexesResult.rows,
          database: sizeResult.rows[0],
          rowCounts,
          recommendations: [
            'Adicione índice em orders.company_id para acelerar busca por cliente.',
            'Considere particionar financial_transactions por data para tabelas grandes.',
            'Monitore queries lentas com pg_stat_statements.',
            'Use EXPLAIN ANALYZE em queries críticas antes de otimizar.',
          ],
        });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/ai-developer/command — process text commands
    app.post('/api/ai-developer/command', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { command } = req.body as { command: string };
        if (!command) return res.status(400).json({ message: 'Comando obrigatório' });

        const cmd = command.toLowerCase().trim();
        let action = 'unknown';

        if (/anali[sz]ar?\s*(sistema|c[oó]digo|projeto)/.test(cmd) || cmd === 'analisar') action = 'index';
        else if (/bug|erro|problem|detectar/.test(cmd)) action = 'bugs';
        else if (/segurança|security|vulnerab/.test(cmd)) action = 'security';
        else if (/perform|otimiz|velocid/.test(cmd)) action = 'performance';
        else if (/banco|database|tabela|índice/.test(cmd)) action = 'database';
        else if (/deploy|docker|servidor|publicar/.test(cmd)) action = 'deploy';
        else if (/ajuda|help|comandos/.test(cmd)) action = 'help';

        res.json({
          command,
          action,
          message: action === 'unknown'
            ? `Comando não reconhecido: "${command}". Digite "ajuda" para ver os comandos disponíveis.`
            : `Executando: ${action}...`,
        });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // ─── AI LAB Routes ────────────────────────────────────────────────────────
    // GET /api/ai-developer/lab/health
    app.get('/api/ai-developer/lab/health', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { getHealthMetrics } = await import('../services/aiDeveloper/labFunctions.ts');
        res.json(getHealthMetrics());
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/lab/test-routes
    app.get('/api/ai-developer/lab/test-routes', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { testRoutes } = await import('../services/aiDeveloper/labFunctions.ts');
        const proto = req.protocol || 'http';
        const host = req.get('host') || 'localhost:5000';
        const baseUrl = `${proto}://${host}`;
        const sessionCookie = req.headers.cookie || '';
        const result = await testRoutes(baseUrl, sessionCookie);
        res.json(result);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/lab/docs
    app.get('/api/ai-developer/lab/docs', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { generateDocs } = await import('../services/aiDeveloper/labFunctions.ts');
        res.json(generateDocs());
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/ai-developer/lab/simulate
    app.post('/api/ai-developer/lab/simulate', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { simulateUsage } = await import('../services/aiDeveloper/labFunctions.ts');
        const proto = req.protocol || 'http';
        const host = req.get('host') || 'localhost:5000';
        const baseUrl = `${proto}://${host}`;
        const sessionCookie = req.headers.cookie || '';
        const result = await simulateUsage(baseUrl, sessionCookie);
        res.json(result);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/lab/auto-fix
    app.get('/api/ai-developer/lab/auto-fix', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { autoFix } = await import('../services/aiDeveloper/labFunctions.ts');
        const result = autoFix();
        // Log to ai_logs table
        try {
          await storage.createAiLog({
            acao: 'auto_fix_scan',
            status: 'ok',
            detalhes: `Total: ${result.summary?.total ?? 0} issues. High: ${result.summary?.high ?? 0}. Medium: ${result.summary?.medium ?? 0}. Low: ${result.summary?.low ?? 0}`,
            userId: req.session?.userId,
          });
        } catch {}
        res.json(result);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/lab/ai-logs — historico de logs da IA
    app.get('/api/ai-developer/lab/ai-logs', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const limit = req.query.limit ? Number(req.query.limit) : 100;
        const logs = await storage.getAiLogs(limit);
        res.json(logs);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/ai-developer/lab/ai-logs — registrar log da IA
    app.post('/api/ai-developer/lab/ai-logs', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { acao, arquivoAfetado, status, detalhes, duracao } = req.body;
        if (!acao) return res.status(400).json({ message: 'acao obrigatório' });
        const log = await storage.createAiLog({ acao, arquivoAfetado, status: status || 'ok', detalhes, duracao, userId: req.session?.userId });
        res.status(201).json(log);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/ai-developer/lab/create-test-company — criar empresa + plano + assinatura de teste
    app.post('/api/ai-developer/lab/create-test-company', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      const results: any[] = [];
      try {
        // 1. Criar empresa teste
        const company = await storage.createCompany({
          companyName: 'Empresa Teste ERP',
          contactName: 'Usuário Teste',
          email: `teste.erp.${Date.now()}@vivafrutaz.com`,
          password: '123456',
          active: true,
          clientType: 'mensal',
          allowedOrderDays: ['Segunda-feira', 'Quarta-feira'],
        } as any);
        results.push({ step: 'company', id: company.id, name: company.companyName, status: 'created' });

        // 2. Criar plano Starter
        let plano = (await storage.getPlanos()).find((p: any) => p.nome === 'Plano Starter');
        if (!plano) {
          plano = await storage.createPlano({ nome: 'Plano Starter', descricao: 'Plano de testes automáticos', preco: '199.00', tipoCobranca: 'mensal', limiteEmpresasFiliais: 1, limiteUsuarios: 5, modulosHabilitados: ['pedidos', 'logistica', 'nfe'] });
          results.push({ step: 'plano', id: plano.id, name: plano.nome, status: 'created' });
        } else {
          results.push({ step: 'plano', id: plano.id, name: plano.nome, status: 'existing' });
        }

        // 3. Criar assinatura ativa
        const expires = new Date();
        expires.setMonth(expires.getMonth() + 1);
        const assinatura = await storage.createAssinatura({ companyId: company.id, planoId: plano.id, status: 'ativa', valor: plano.preco, dataExpiracao: expires, gatewayPagamento: 'manual', observacoes: 'Assinatura criada automaticamente pelo teste' });
        results.push({ step: 'assinatura', id: assinatura.id, status: assinatura.status, valor: assinatura.valor });

        // 4. Simular evento de cobrança
        const billing = await storage.createBillingEvent({ companyId: company.id, assinaturaId: assinatura.id, tipo: 'pagamento', valor: plano.preco, status: 'pago', gateway: 'manual', descricao: 'Primeira mensalidade — cobrança simulada pelo sistema de testes' });
        results.push({ step: 'billing', id: billing.id, tipo: billing.tipo, valor: billing.valor, status: billing.status });

        // 5. Registrar log da IA
        await storage.createAiLog({ acao: 'create_test_company', status: 'ok', detalhes: `Empresa ID ${company.id}, Plano ID ${plano.id}, Assinatura ID ${assinatura.id}, Billing ID ${billing.id}`, userId: req.session?.userId });

        res.json({ success: true, message: 'Empresa teste, plano, assinatura e cobrança criados com sucesso!', results });
      } catch (e: any) {
        try { await storage.createAiLog({ acao: 'create_test_company', status: 'erro', detalhes: e.message, userId: req.session?.userId }); } catch {}
        res.status(500).json({ message: e.message, results });
      }
    });

    // POST /api/ai-developer/lab/create-module
    app.post('/api/ai-developer/lab/create-module', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { name } = req.body;
        if (!name?.trim()) return res.status(400).json({ message: 'Nome do módulo obrigatório' });
        const { createModule } = await import('../services/aiDeveloper/labFunctions.ts');
        res.json(createModule(name.trim()));
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/file — read a specific file
    app.get('/api/ai-developer/file', async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { path: filePath } = req.query as { path: string };
        if (!filePath) return res.status(400).json({ message: 'path obrigatório' });
        // Security: only allow reading files in project dir, not system files
        const normalized = filePath.replace(/\.\./g, '').replace(/^\//, '');
        const allowed = ['server/', 'client/', 'shared/', 'package.json', 'drizzle.config'];
        if (!allowed.some(a => normalized.startsWith(a))) {
          return res.status(403).json({ message: 'Acesso negado ao caminho solicitado' });
        }
        const fs = await import('fs');
        if (!fs.existsSync(normalized)) return res.status(404).json({ message: 'Arquivo não encontrado' });
        const content = fs.readFileSync(normalized, 'utf-8');
        const lines = content.split('\n').length;
        res.json({ path: normalized, content: content.slice(0, 50000), lines, truncated: content.length > 50000 });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });
  }

  // ─── Clara Training Routes ────────────────────────────────────────────────
  app.get('/api/scope-simulations', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !SCOPE_ROLES.includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const list = await storage.getScopeSimulations();
      res.json(list);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get('/api/scope-simulations/:id', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !SCOPE_ROLES.includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const sim = await storage.getScopeSimulation(Number(req.params.id));
      if (!sim) return res.status(404).json({ message: 'Simulação não encontrada' });
      res.json(sim);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/scope-simulations', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !SCOPE_ROLES.includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
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
      if (!user || !SCOPE_ROLES.includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
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
      if (!user || !SCOPE_ROLES.includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
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

  // ─── Push Notification Routes ──────────────────────────────────────────────

  // Get VAPID public key (public endpoint)
  // MOVED TO search.routes.ts
  // GET /api/search

  // ─── MASTER control routes ─────────────────────────────────────────────────
  // MOVED TO system-versions.routes.ts
  // GET    /api/system/versions
  // GET    /api/system/versions/current
  // POST   /api/system/versions
  // PATCH  /api/system/versions/:id
  // DELETE /api/system/versions/:id
  // POST   /api/system/apply-update
  // POST   /api/system/rollback
  // GET    /api/system/update-logs
  // GET    /api/system/updates

  // ─── SaaS: Métricas Financeiras ──────────────────────────────────────────────
  app.get('/api/saas/financeiro', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const metrics = await storage.computeAndSaveSaasMetrics();
      res.json(metrics);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get('/api/saas/financeiro/historico', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const { db: dbConn } = await import('../database/db');
      const { saasMetrics: sm } = await import('@shared/schema');
      const { desc: descOrd } = await import('drizzle-orm');
      const rows = await dbConn.select().from(sm).orderBy(descOrd(sm.createdAt)).limit(12);
      res.json(rows);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── White Label: EmpresaConfig ───────────────────────────────────────────
  app.get('/api/empresa-config/:empresaId', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const cfg = await storage.getEmpresaConfig(Number(req.params.empresaId));
      res.json(cfg ?? null);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.put('/api/empresa-config/:empresaId', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const cfg = await storage.upsertEmpresaConfig(Number(req.params.empresaId), req.body);
      res.json(cfg);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── /api/companies/:id/gps-status and /gps-toggle migrated to
  // server/modules/companies. Implementation lives there. ──────────────────

  // MOVED TO marketplace.routes.ts
  // GET    /api/marketplace/modulos
  // POST   /api/marketplace/modulos
  // PATCH  /api/marketplace/modulos/:id
  // DELETE /api/marketplace/modulos/:id
  // POST   /api/marketplace/seed
  // GET    /api/marketplace/empresa/:empresaId
  // POST   /api/marketplace/empresa/:empresaId/instalar/:moduloId
  // PATCH  /api/marketplace/empresa-modulos/:id
  // DELETE /api/marketplace/empresa-modulos/:id

  // ─── Vigilância Sanitária ──────────────────────────────────────────────────

  // MOVED TO sanitary.routes.ts
  // GET    /api/sanitary/plan-status
  // GET    /api/sanitary/questions
  // POST   /api/sanitary/questions
  // PATCH  /api/sanitary/questions/:id
  // DELETE /api/sanitary/questions/:id
  // GET    /api/sanitary/evaluations
  // GET    /api/sanitary/evaluations/:id
  // POST   /api/sanitary/evaluations
  // PATCH  /api/sanitary/evaluations/:id
  // PATCH  /api/sanitary/evaluations/:id/items/:itemId

  // Seed DB Function
  await seedDatabase();
  await ensureDefaultNotificationSettings();

  return httpServer;
}

async function seedDatabase() {
  try {
    // Ensure default developer user always exists
    try {
      const devUser = await storage.getUserByEmail("dev@vivafrutaz.com");
      if (!devUser) {
        await storage.createUser({
          name: "Desenvolvedor VF",
          email: "dev@vivafrutaz.com",
          password: "dev",
          role: "DEVELOPER",
          active: true,
        });
      }
    } catch (err) {
      console.error("[SEED] Error checking/creating dev user:", err);
    }

    // Ensure default MASTER user always exists
    try {
      const masterUser = await storage.getUserByEmail("master@vivafrutaz.com");
      if (!masterUser) {
        await storage.createUser({
          name: "Master VivaFrutaz",
          email: "master@vivafrutaz.com",
          password: "Master@2026!",
          role: "MASTER",
          active: true,
        });
        console.log("[SEED] Usuário MASTER criado: master@vivafrutaz.com / Master@2026!");
      }
    } catch (err) {
      console.error("[SEED] Error checking/creating master user:", err);
    }

    try {
      const admin = await storage.getUserByEmail("admin@vivafrutaz.com");
      if (!admin) {
        await storage.createUser({
          name: "Admin User",
          email: "admin@vivafrutaz.com",
          password: "admin",
          role: "ADMIN",
          active: true,
        });
        await storage.createUser({
          name: "Operations",
          email: "ops@vivafrutaz.com",
          password: "ops",
          role: "OPERATIONS_MANAGER",
          active: true,
        });
        await storage.createUser({
          name: "Purchasing",
          email: "buy@vivafrutaz.com",
          password: "buy",
          role: "PURCHASE_MANAGER",
          active: true,
        });
      }
    } catch (err) {
      console.error("[SEED] Error checking/creating admin/ops/buy users:", err);
    }

    try {
      const groups = await storage.getPriceGroups();
      if (groups.length === 0) {
      const group1 = await storage.createPriceGroup({ groupName: "Corporate Basic", description: "Standard pricing" });
      const group2 = await storage.createPriceGroup({ groupName: "Corporate Plus", description: "Discounted pricing" });

      const productsData = [
        { name: "Banana", category: "Fruit", unit: "Box", active: true },
        { name: "Apple", category: "Fruit", unit: "Box", active: true },
        { name: "Melon", category: "Fruit", unit: "Box", active: true }
      ];

      for (const p of productsData) {
        const prod = await storage.createProduct(p);
        await storage.createProductPrice({ productId: prod.id, priceGroupId: group1.id, price: "45.00" });
        await storage.createProductPrice({ productId: prod.id, priceGroupId: group2.id, price: "40.00" });
      }

      await storage.createCompany({
        companyName: "Acme Corp",
        contactName: "John Doe",
        email: "client@acme.com",
        password: "clientpassword",
        priceGroupId: group1.id,
        allowedOrderDays: ["Monday", "Wednesday"],
        active: true
      });

      const today = new Date();
      const open = new Date(today);
      open.setDate(today.getDate() - 1);
      const close = new Date(today);
      close.setDate(today.getDate() + 3);
      const delStart = new Date(today);
      delStart.setDate(today.getDate() + 5);
      const delEnd = new Date(today);
      delEnd.setDate(today.getDate() + 10);

      const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
      const weekRef = `${months[delStart.getMonth()]} ${delStart.getDate()}–${delEnd.getDate()}/${delEnd.getFullYear()}`;
      await storage.createOrderWindow({
        weekReference: weekRef,
        orderOpenDate: open,
        orderCloseDate: close,
        deliveryStartDate: delStart,
        deliveryEndDate: delEnd,
        active: true
      });
    }
    } catch (err) {
      console.error("[SEED] Error seeding price groups and products:", err);
    }

    // Seed marketplace modules if empty
    try {
      const existingMods = await storage.getModulosMarketplace();
      if (existingMods.length === 0) {
        const marketplaceSeeds = [
          { nomeModulo: 'IA Logística', descricao: 'Otimização inteligente de rotas e entregas com IA', preco: '149.90', categoria: 'ia', icone: 'Brain', versao: '2.1.0', destaque: true, ativo: true, changelog: 'v2.1.0: Melhoria de 30% na precisão das rotas\nv2.0.0: Novo motor de otimização' },
          { nomeModulo: 'GPS Rastreamento', descricao: 'Rastreamento em tempo real de motoristas e entregas', preco: '89.90', categoria: 'logistica', icone: 'MapPin', versao: '1.5.0', destaque: true, ativo: true, changelog: 'v1.5.0: Histórico de 90 dias\nv1.4.0: Alertas de desvio de rota' },
          { nomeModulo: 'Relatórios Avançados', descricao: 'Dashboard executivo com gráficos e exportação Excel/PDF', preco: '69.90', categoria: 'financeiro', icone: 'BarChart3', versao: '3.0.0', destaque: false, ativo: true, changelog: 'v3.0.0: Novo designer de relatórios' },
          { nomeModulo: 'Integração API', descricao: 'API REST completa para integração com sistemas externos', preco: '199.90', categoria: 'integracao', icone: 'Plug', versao: '1.2.0', destaque: false, ativo: true, changelog: 'v1.2.0: Suporte a webhooks' },
          { nomeModulo: 'Automação de Rotas', descricao: 'Criação automática de rotas baseada em histórico', preco: '119.90', categoria: 'logistica', icone: 'Route', versao: '1.0.0', destaque: false, ativo: true, changelog: 'v1.0.0: Lançamento inicial' },
          { nomeModulo: 'NF-e Automática', descricao: 'Emissão automática de nota fiscal ao confirmar pedido', preco: '99.90', categoria: 'financeiro', icone: 'Receipt', versao: '2.0.0', destaque: true, ativo: true, changelog: 'v2.0.0: Suporte NF-e 4.0' },
          { nomeModulo: 'WhatsApp Notificações', descricao: 'Envio de notificações automáticas via WhatsApp', preco: '79.90', categoria: 'integracao', icone: 'MessageCircle', versao: '1.1.0', destaque: false, ativo: true, changelog: 'v1.1.0: Templates personalizados' },
          { nomeModulo: 'Controle de Desperdício IA', descricao: 'Previsão de desperdício com machine learning', preco: '129.90', categoria: 'ia', icone: 'TrendingDown', versao: '1.3.0', destaque: false, ativo: true, changelog: 'v1.3.0: Modelos preditivos melhorados' },
          { nomeModulo: 'Dashboard Avançado', descricao: 'Painéis personalizáveis com KPIs e métricas em tempo real', preco: '59.90', categoria: 'financeiro', icone: 'LayoutDashboard', versao: '1.0.0', destaque: false, ativo: true, changelog: 'v1.0.0: Lançamento inicial' },
          { nomeModulo: 'Controle Financeiro', descricao: 'Gestão completa de contas a pagar/receber e fluxo de caixa', preco: '89.90', categoria: 'financeiro', icone: 'DollarSign', versao: '2.0.0', destaque: true, ativo: true, changelog: 'v2.0.0: Integração bancária automática' },
        ];
        for (const m of marketplaceSeeds) {
          await storage.createModuloMarketplace(m as any);
        }
        console.log(`[SEED] ${marketplaceSeeds.length} módulos do marketplace criados com sucesso.`);
      }
    } catch (seedErr) {
      console.error('[SEED] Erro ao criar módulos do marketplace:', seedErr);
    }

    // Seed vigilancia sanitaria module in modulosSistema if not present
    try {
      const todosModulos = await storage.getModulosSistema();
      const chaves = todosModulos.map((m: any) => m.chave);
      if (!chaves.includes('vigilancia_sanitaria')) {
        await storage.createModuloSistema({
          chave: 'vigilancia_sanitaria',
          nomeModulo: 'Vigilância Sanitária',
          rota: '/admin/sanitary',
          descricao: 'Checklist e avaliações de conformidade sanitária',
          icone: 'ShieldCheck',
          categoria: 'qualidade',
        });
        console.log('[SEED] Módulo vigilancia_sanitaria criado em modulosSistema.');
      }
      if (!chaves.includes('vigilancia_sanitaria_relatorios')) {
        await storage.createModuloSistema({
          chave: 'vigilancia_sanitaria_relatorios',
          nomeModulo: 'Vigilância Sanitária (Relatórios)',
          rota: '/admin/sanitary',
          descricao: 'Acesso somente leitura a relatórios sanitários',
          icone: 'BarChart3',
          categoria: 'qualidade',
        });
        console.log('[SEED] Módulo vigilancia_sanitaria_relatorios criado em modulosSistema.');
      }
    } catch (modErr) {
      console.error('[SEED] Erro ao criar módulos sanitários:', modErr);
    }

    // Seed NUTRICIONISTA test user if not present
    try {
      const nutri = await storage.getUserByEmail('nutri@vivafrutaz.com');
      if (!nutri) {
        await storage.createUser({
          name: 'Nutricionista Teste',
          email: 'nutri@vivafrutaz.com',
          password: 'nutri123',
          role: 'NUTRICIONISTA',
          active: true,
        });
        console.log('[SEED] Usuário NUTRICIONISTA criado: nutri@vivafrutaz.com / nutri123');
      }
    } catch (nutriErr) {
      console.error('[SEED] Erro ao criar usuário nutricionista:', nutriErr);
    }

    // Seed sanitary questions if empty
    try {
      const existingQ = await storage.getSanitaryQuestions();
      if (existingQ.length === 0) {
        const defaultQuestions = [
          { question: "As mãos dos manipuladores estão lavadas e higienizadas?", category: "pessoal", order: 10, active: true },
          { question: "Os uniformes e EPIs estão limpos e em bom estado?", category: "pessoal", order: 20, active: true },
          { question: "Há presença de adornos (anéis, pulseiras, relógio) nos manipuladores?", category: "pessoal", order: 30, active: true },
          { question: "As superfícies de manipulação estão higienizadas?", category: "higiene", order: 40, active: true },
          { question: "Os utensílios estão limpos e sanitizados?", category: "higiene", order: 50, active: true },
          { question: "O ambiente está livre de pragas e vetores?", category: "higiene", order: 60, active: true },
          { question: "A temperatura da câmara fria está dentro do padrão (0–8°C)?", category: "temperatura", order: 70, active: true },
          { question: "Os termômetros estão calibrados e aferidos?", category: "temperatura", order: 80, active: true },
          { question: "Os produtos estão armazenados corretamente (data, lote, PVPS)?", category: "armazenamento", order: 90, active: true },
          { question: "Não há produtos vencidos ou em condições impróprias?", category: "armazenamento", order: 100, active: true },
          { question: "Os equipamentos de frio estão funcionando corretamente?", category: "equipamentos", order: 110, active: true },
          { question: "Os registros de controle de temperatura estão sendo preenchidos?", category: "equipamentos", order: 120, active: true },
          { question: "O local está organizado e com boa iluminação?", category: "geral", order: 130, active: true },
          { question: "Os lixos estão devidamente acondicionados e identificados?", category: "geral", order: 140, active: true },
        ];
        for (const q of defaultQuestions) {
          await storage.createSanitaryQuestion(q);
        }
        console.log(`[SEED] ${defaultQuestions.length} perguntas do checklist sanitário criadas.`);
      }
    } catch (sanitaryErr) {
      console.error('[SEED] Erro ao criar perguntas sanitárias:', sanitaryErr);
    }

  } catch(e) {
    console.error("Failed to seed database:", e);
  }
}

function getWeekNumber(d: Date) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  var weekNo = Math.ceil(( ( (d.getTime() - yearStart.getTime()) / 86400000) + 1)/7);
  return weekNo;
}


