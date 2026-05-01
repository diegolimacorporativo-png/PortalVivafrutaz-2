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
import { register as scopeSimulationsRegister } from './scope-simulations.routes';
import { register as smtpConfigRegister } from './smtp-config.routes';
import { register as empresaConfigRegister } from './empresa-config.routes';
import { register as priceGroupsRegister } from './price-groups.routes';
import { register as productPricesRegister } from './product-prices.routes';
import { register as orderWindowsRegister } from './order-windows.routes';
import { register as settingsRegister } from './settings.routes';
import { register as reportsRegister } from './reports.routes';
import { register as auditRegister } from './audit.routes';
import { register as executiveDashboardRegister } from './executive-dashboard.routes';
import { register as clientIntelligenceRegister } from './client-intelligence.routes';
import { register as clientContractScopeRegister } from './client-contract-scope.routes';
import { register as systemSyncRegister } from './system-sync.routes';
import { register as assistantRegister } from './assistant.routes';
import { register as fiscalInvoicesRegister } from './fiscal-invoices.routes';
import { register as certificatesRegister } from './certificates.routes';
import { register as adminIntelligenceRegister } from './admin-intelligence.routes';

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
  scopeSimulationsRegister(app);
  smtpConfigRegister(app);
  empresaConfigRegister(app);
  priceGroupsRegister(app);
  productPricesRegister(app);
  orderWindowsRegister(app);
  settingsRegister(app);
  reportsRegister(app);
  auditRegister(app);
  executiveDashboardRegister(app);
  clientIntelligenceRegister(app);
  clientContractScopeRegister(app);
  systemSyncRegister(app);
  assistantRegister(app);
  fiscalInvoicesRegister(app);
  await certificatesRegister(app);
  adminIntelligenceRegister(app);

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
  // --- Admin Audit — MOVED TO audit.routes.ts ---
  // GET    /api/admin/audit

  // ─── admin-intelligence — MOVED TO admin-intelligence.routes.ts ───
  // GET  /api/admin/intelligence
  // POST /api/admin/intelligence/auto-fix

  // --- System Sync API — MOVED TO system-sync.routes.ts ---
  // POST /api/admin/system-sync

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

  // --- Price Groups — MOVED TO price-groups.routes.ts ---
  // GET    api.priceGroups.list.path
  // POST   api.priceGroups.create.path
  // PUT    api.priceGroups.update.path
  // DELETE api.priceGroups.delete.path

  // Products CRUD + sub-categories → migrated to server/modules/products/
  // (mounted at /api/products by registerModules, BEFORE this legacy block).

  // --- Product Prices — MOVED TO product-prices.routes.ts ---
  // GET    api.productPrices.list.path
  // GET    api.productPrices.byProduct.path
  // POST   api.productPrices.create.path
  // PUT    api.productPrices.update.path
  // DELETE api.productPrices.delete.path

  // --- Order Windows — MOVED TO order-windows.routes.ts ---
  // GET    api.orderWindows.list.path
  // GET    api.orderWindows.active.path
  // POST   api.orderWindows.create.path
  // PUT    api.orderWindows.update.path
  // DELETE api.orderWindows.delete.path

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

  // --- Settings / Company Config / Company Settings — MOVED TO settings.routes.ts ---
  // GET    /api/settings/:key
  // PUT    /api/settings/:key
  // GET    /api/company-config/logo
  // GET    /api/company-config
  // PATCH  /api/company-config
  // GET    /api/company-settings/:empresaId
  // POST   /api/company-settings/:empresaId
  // PUT    /api/company-settings/:empresaId

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

  // --- Reports — MOVED TO reports.routes.ts ---
  // GET    /api/reports/industrialized
  // GET    api.reports.purchasing.path
  // GET    api.reports.financial.path

  // --- Test Mode / Test Orders / Maintenance Mode — MOVED TO settings.routes.ts ---
  // GET    /api/settings/test-mode
  // POST   /api/settings/test-mode
  // GET    /api/admin/test-orders
  // GET    /api/settings/maintenance
  // POST   /api/settings/maintenance

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
  // --- Audit — MOVED TO audit.routes.ts ---
  // GET    /api/audit

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

  // --- Executive Dashboard — MOVED TO executive-dashboard.routes.ts ---
  // GET    /api/executive-dashboard

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

  // ─── fiscal-invoices CRUD — MOVED TO fiscal-invoices.routes.ts ───
  // GET    /api/fiscal-invoices
  // GET    /api/fiscal-invoices/check-duplicate
  // GET    /api/fiscal-invoices/:id
  // POST   /api/fiscal-invoices
  // DELETE /api/fiscal-invoices/:id

  // ── Geocoding proxy (Nominatim) ────────────────────────────
  // MOVED TO geocode.routes.ts
  // GET /api/geocode

  // MOVED TO about-us.routes.ts
  // GET /api/about-us
  // PUT /api/about-us

  // ─── SMTP Config Routes ──────────────────────────────────────────────────────
  // MOVED TO smtp-config.routes.ts
  // GET    /api/smtp-config
  // PUT    /api/smtp-config
  // POST   /api/smtp-config/test

  // ─── IA ASSISTENTE VIRTUAL — MOVED TO assistant.routes.ts ─────
  // GET  /api/assistant/history
  // POST /api/assistant/chat

    // --- Commercial Intelligence — MOVED TO client-intelligence.routes.ts ---
  // GET    /api/commercial-intelligence

  // --- Financial Intelligence — MOVED TO client-intelligence.routes.ts ---
  // GET    /api/financial-intelligence

  // --- Logistics Intelligence — MOVED TO client-intelligence.routes.ts ---
  // GET    /api/logistics-intelligence

  // --- Client Contract Scope — MOVED TO client-contract-scope.routes.ts ---
  // GET    /api/client/contract-scope
  // POST   /api/client/scope-change-request

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
  // ─── Certificates — MOVED TO certificates.routes.ts ───
  // GET    /api/admin/certificates/audit
  // POST   /api/admin/certificates/migrate-legacy
  // POST   /api/company/certificate
  // GET    /api/company/certificate
  // DELETE /api/company/certificate

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

  // MOVED TO scope-simulations.routes.ts
  // GET    /api/scope-simulations
  // GET    /api/scope-simulations/:id
  // POST   /api/scope-simulations
  // PATCH  /api/scope-simulations/:id
  // DELETE /api/scope-simulations/:id
  // POST   /api/scope-simulations/:id/convert

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

  // MOVED TO saas.routes.ts (financeiro)
  // GET /api/saas/financeiro
  // GET /api/saas/financeiro/historico

  // MOVED TO empresa-config.routes.ts
  // GET /api/empresa-config/:empresaId
  // PUT /api/empresa-config/:empresaId

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


