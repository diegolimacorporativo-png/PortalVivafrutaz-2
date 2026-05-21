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
import { randomBytes } from "crypto";
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
import { resolveTenant } from "../core/tenant/context";
// MT-3B M4 — crossTenant() marks intentional global reads; greppable audit trail.
import { crossTenant } from "../core/tenant/scope";
import { logSecurityEvent } from "../core/security/securityLogger";
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
// N+1-FIX: getFaturamentoContext is used in the /api/nfe/eligible batch query
// instead of calling canEmitNFe once per row.
import { getFaturamentoContext } from "../modules/nfe/faturamento.engine";
import { getRequestIdForLog } from "../core/context/requestContext";
// FASE 3/6.5 — guarda de tenant e wrapper multi-tenant
import { validateOrderTenant, safeGetOrder, withTenantGuard, validateCompanyTenant } from "../core/security/orderSecurity";
// FASE 9A — logSecurity for NF-e error visibility
import { logSecurity } from "../core/security/securityLogger";
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
import { register as nfeDashboardRegister } from './nfe-dashboard.routes';
import { register as securityEventsRegister } from './security-events.routes';
import { register as securityAnalysisRegister } from './security-analysis.routes';
import { register as securityAlertsRegister } from './security-alerts.routes';
import { register as securityOverviewRegister } from './security-overview.routes';
import { register as securityRiskRegister } from './security-risk.routes';
import { registerEventRoutes } from './event.routes';
import { registerGovernanceRoutes } from './governance.routes';
import { registerAlertRoutes } from './alert.routes';
import { registerPolicyRoutes } from './policy.routes';
import { registerSystemStateRoutes } from './system-state.routes';
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
import { simpleRateLimit } from '../core/http/rateLimit';
import { sensitiveActionLimiter } from '../core/security/rateLimit';
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
import { register as smtpTestRegister } from './smtp-test.routes';
import { register as bankRegister } from './bank.routes';
import { register as observabilityRegister } from './observability.routes';
import { register as operationsRegister } from './operations.routes';
import { register as fiscalDiagnosticsRegister } from './fiscal-diagnostics.routes';
import { register as systemStatusRegister } from './system-status.routes';
import {
  validateCceLimit,
  validateCceTimeWindow,
  validateCceStatus,
  validateCceMotivo,
  isCceRuleViolation,
} from '../modules/nfe/nfe-cce-rules.service';
import { recordCceAudit } from '../modules/nfe/nfe-cce-audit.service';


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

  // FASE 13.6 — Rate limit global (unauthenticated IPs, 60 req/min)
  app.use(simpleRateLimit);

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
  await bankRegister(app);
  tasksRegister(app);
  quotationsRegister(app);
  wasteControlRegister(app);
  orderExceptionsRegister(app);
  specialOrderRequestsRegister(app);
  passwordResetRequestsRegister(app);
  orderCleanupRegister(app);
  aboutUsRegister(app);
  securityRegister(app);
  nfeDashboardRegister(app);      // NF-e Dashboard READ ONLY (GET /api/admin/nfe/metrics|timeline|recent-errors)
  securityEventsRegister(app);    // FASE 7.1 — in-memory security event stream
  securityAnalysisRegister(app);  // FASE 7.2 — per-IP risk analysis + spike detection
  securityAlertsRegister(app);    // FASE 11 — operational alert engine (GET /api/admin/security/alerts)
  securityOverviewRegister(app);  // FASE 14.8 — DB-backed risk intelligence (GET /api/admin/security/overview)
  securityRiskRegister(app);      // FASE 14.9 — Risk Derivation Layer READ-ONLY (GET /api/admin/security/risk)
  registerEventRoutes(app);
  registerGovernanceRoutes(app);
  registerAlertRoutes(app);
  registerPolicyRoutes(app);
  registerSystemStateRoutes(app);
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
  smtpTestRegister(app);
  observabilityRegister(app);
  operationsRegister(app);
  fiscalDiagnosticsRegister(app);
  systemStatusRegister(app);

  // --- Backup Routes — MOVED TO backup.routes.ts ---
  // GET    /api/admin/backups
  // POST   /api/admin/backups
  // POST   /api/admin/backups/sql
  // GET    /api/admin/backups/:filename
  // DELETE /api/admin/backups/:filename
  // POST   /api/admin/backups/clean-old

  // ─── smtp-test — MOVED TO smtp-test.routes.ts ───
  // POST /api/admin/smtp-test
  // GET  /api/admin/mailer-status

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

        // BUG-02-FIX: unblockUser only clears the tenant-mismatch in-memory block
        // and the security_blocked_users DB record. It does NOT reset the
        // isLocked / loginAttempts state on the actual users / companies table,
        // meaning the account remains fully locked for normal logins after unblock.
        // Fix: look up the account by email and reset both tables.
        const [userRow, companyRow] = await Promise.all([
          storage.getUserByEmail(email).catch(() => null),
          storage.getCompanyByEmail(email).catch(() => null),
        ]);
        const resetUpdates = { isLocked: false, loginAttempts: 0 } as any;
        await Promise.all([
          userRow    ? storage.updateUser(userRow.id, resetUpdates).catch(() => null)       : Promise.resolve(),
          companyRow ? storage.updateCompany(companyRow.id, resetUpdates).catch(() => null) : Promise.resolve(),
        ]);

        return res.json({
          success: true,
          data: {
            email: email.toLowerCase(),
            wasBlocked,
            resetUser: !!userRow,
            resetCompany: !!companyRow,
          },
          message: wasBlocked
            ? 'Usuário desbloqueado e estado de login resetado com sucesso'
            : 'Usuário não estava bloqueado (estado de login resetado)',
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
  // H4-FIX: requireAuthCore added — unauthenticated callers were able to reach
  // the tenant guard and controller without a valid session.
  app.post('/api/orders/:orderId/substitute-item', requireAuthCore, async (req: Request, res: Response, next: NextFunction) => {
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
  // H5-FIX: requireRole added — staff/client sessions could query any company's
  // orders by passing empresaId. Restricted to internal privileged roles only.
  app.get(api.orders.list.path, requireAuthCore, requireRole(["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"]), async (req, res) => {
    const orders = await storage.getOrders(Number(req.query.empresaId));
    res.json(orders);
  });

  app.get(api.orders.companyOrders.path, async (req, res) => {
    // FASE 6 BATCH 2 — auth guard.
    if (!req.session?.userId && !req.session?.companyId) {
      return res.status(401).json({ message: 'Não autenticado' });
    }
    const requestedCompanyId = Number(req.params.companyId);
    // FASE 6 — padronização: usa validateCompanyTenant (padrão único).
    // Lança ForbiddenError + log [SECURITY] TENANT_MISMATCH em mismatch.
    try {
      validateCompanyTenant(requestedCompanyId, req);
    } catch (err) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    const orders = await storage.getCompanyOrders(requestedCompanyId);
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
  // TTL cleanup every 5 min — prunes entries older than the 60s dedup window
  // to prevent unbounded Map growth over long uptimes.
  const recentOrders = new Map<string, number>();
  setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [k, ts] of recentOrders) {
      if (ts < cutoff) recentOrders.delete(k);
    }
  }, 5 * 60_000).unref();

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

  // Planejamento de compras movido para purchase-planning.routes.ts

  // ── Estoque / Inventário ────────────────────────────────────
  // ⛔ MIGRATED: all `/api/inventory/*` endpoints now live in
  //    `server/modules/inventory/`. The module router is mounted BEFORE
  //    `registerRoutes(app)` in `server/app.ts` so it takes precedence.
  //    Inline handlers were removed in 2026-04 to delete dead code.

  // POST /api/fiscal-invoices/parse-pdf — extract text from PDF server-side
  app.post('/api/fiscal-invoices/parse-pdf', requireAuthCore, uploadInMemory.single('file'), async (req: any, res) => {
    resolveTenant(req);
    logSecurityEvent({ type: "FISCAL_INVOICES_PARSE_PDF", userId: req.session?.userId, path: req.originalUrl, requestId: req.requestId });
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
  app.post('/api/import/preview', requireAuthCore, uploadInMemory.single('file'), async (req: any, res) => {
    resolveTenant(req);
    logSecurityEvent({ type: "IMPORT_PREVIEW", userId: req.session?.userId, path: req.originalUrl, requestId: req.requestId });
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
  app.post('/api/import/execute', sensitiveActionLimiter, requireAuthCore, requireRole(["ADMIN"]), async (req: any, res) => {
    resolveTenant(req);
    logSecurityEvent({ type: "IMPORT_EXECUTE", userId: req.session?.userId, path: req.originalUrl, requestId: req.requestId, metadata: { mode: req.body?.mode } });
    const actor = await storage.getUser(req.session.userId);
    if (!actor) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const { rows, mode } = req.body as { rows: Record<string, any>[]; mode: 'products' | 'orders' | 'clients' | 'auto' };
      const results = { created: 0, skipped: 0, errors: [] as string[] };

      // MT-3B M4 — intentional cross-tenant reads: import dedup uses the global catalog.
      void crossTenant();
      const existingProducts = await storage.getProducts();
      const productCodeMap = Object.fromEntries(existingProducts.map((p: any) => [String(p.productCode || p.code || '').toLowerCase(), p]));
      const productNameMap = Object.fromEntries(existingProducts.map((p: any) => [String(p.name || '').toLowerCase(), p]));

      void crossTenant();
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
    const { gerarDANFE, parseXmlToDanfeData } = await import('../services/nfe/danfeGenerator.ts');
    const { enviarNFeSEFAZ, consultarStatusSEFAZ } = await import('../services/nfe/nfeSender.ts');

    // STEP 9.3C — buildNFeInput extraído para server/modules/nfe/nfe-input.builder.ts
    // para ser reutilizado pelo cron sem duplicar lógica.
    const { buildNFeInput } = await import('../modules/nfe/nfe-input.builder.ts');

    // GET /api/nfe — list
    // FASE MT-3A (C1+C2): tenantContext pins empresaId via AsyncLocalStorage;
    // currentTenantId() is passed to getNfeEmissoes which applies a subquery
    // JOIN on orders.company_id. MASTER without ?empresaId sees all (intentional).
    app.get('/api/nfe', requireAuthCore, tenantContext, async (req: any, res) => {
      try {
        logSecurityEvent({ type: "NFE_LIST", userId: req.session?.userId, path: req.originalUrl, requestId: req.requestId });
        const { status, orderId } = req.query;
        const companyId = currentTenantId() ?? undefined;
        const data = await storage.getNfeEmissoes({ status: status as string, orderId: orderId ? Number(orderId) : undefined, companyId });
        res.json(data);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/nfe/:id
    // FASE MT-3A (H1): tenantContext pins empresaId; validateOrderTenant now
    // has a real AsyncLocalStorage context to call requireTenantId() against.
    // orderId == null is treated as forbidden (no ownership proof available).
    app.get('/api/nfe/:id', requireAuthCore, tenantContext, async (req: any, res) => {
      try {
        logSecurityEvent({ type: "NFE_GET", userId: req.session?.userId, path: req.originalUrl, requestId: req.requestId, metadata: { id: req.params.id } });
        const nfe = await storage.getNfeEmissao(Number(req.params.id));
        if (!nfe) return res.status(404).json({ message: 'NF-e não encontrada' });
        // NF-e sem orderId não tem prova de ownership — bloqueia.
        if (!nfe.orderId) {
          return res.status(403).json({ message: 'NF-e sem pedido associado — acesso negado' });
        }
        try {
          await validateOrderTenant(nfe.orderId);
        } catch (e: any) {
          if (e instanceof AppError) {
            return res.status(e.status).json({ message: e.message });
          }
          throw e;
        }
        res.json(nfe);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/nfe/can-emit/:orderId — validação prévia (mesma lógica do guard)
    app.get('/api/nfe/can-emit/:orderId', requireAuthCore, requireRole(["MASTER","ADMIN","DEVELOPER","DIRECTOR"]), async (req: any, res) => {
      try {
        resolveTenant(req);
        logSecurityEvent({ type: "NFE_CAN_EMIT", userId: req.session?.userId, path: req.originalUrl, requestId: req.requestId, metadata: { orderId: req.params.orderId } });
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
    // FASE 9A — status codes corrigidos: 422 em erro de validação, 500 em exception.
    // Violações de tenant/auth continuam retornando 401/403/404.
    app.get('/api/nfe/preflight/:orderId', requireAuthCore, tenantContext, async (req: any, res) => {
      resolveTenant(req);
      logSecurityEvent({ type: "NFE_PREFLIGHT", userId: req.session?.userId, path: req.originalUrl, requestId: req.requestId, metadata: { orderId: req.params.orderId } });
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
          // FASE 9A — was 200; now 422 so react-query onError fires correctly
          logSecurity(`[NFE_PREFLIGHT_VALIDATION_FAILED] requestId=${getRequestIdForLog()} | orderId=${orderId} | errors=${validation.length}`);
          return res.status(422).json({
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
        // FASE 9A — was 200; now 500 so exceptions are visible to callers
        logSecurity(`[NFE_PREFLIGHT_EXCEPTION] requestId=${getRequestIdForLog()} | orderId=${orderId} | code=${parsed.code} | message=${e?.message ?? 'unknown'}`);
        return res.status(500).json({
          status: 'error',
          errors: [parsed],
          alerts: [],
        });
      }
    });

    // GET /api/nfe/eligible — STEP 9.3: lista pedidos prontos para emitir NF agora
    // N+1-FIX: replaced 500x canEmitNFe (one JOIN query each) with a single
    // batch JOIN that fetches all candidate data at once. getFaturamentoContext
    // runs in JS for each row — zero additional DB round-trips.
    // MT-3C — tenantContext added: ADMIN/FISCAL/DIRECTOR are per-tenant roles;
    // without scoping they could see eligible orders from other tenants.
    app.get('/api/nfe/eligible', requireAuthCore, requireRole(["ADMIN", "FISCAL", "DIRECTOR"]), tenantContext, async (req: any, res) => {
      try {
        const tenantId = requireTenantId();
        // One query — same JOIN as canEmitNFe but for all candidates at once.
        const raw = await db.execute(sql`
          SELECT
            o.id,
            o.company_id,
            o.status,
            o.fiscal_status,
            o.delivery_date,
            c.client_type,
            c.billing_term,
            c.payment_dates,
            c.contract_start_date,
            c.contract_end_date
          FROM orders o
          JOIN companies c ON c.id = o.company_id
          WHERE o.status != 'CANCELLED'
            AND o.fiscal_status = 'nota_liberada'
            AND o.delivery_date IS NOT NULL
            AND o.company_id = ${tenantId}
          LIMIT 100
        `);

        const candidates = (raw as any).rows as Array<{
          id: number;
          company_id: number;
          status: string;
          fiscal_status: string;
          delivery_date: any;
          client_type: any;
          billing_term: any;
          payment_dates: any;
          contract_start_date: any;
          contract_end_date: any;
        }>;

        // Apply same business rules as canEmitNFe — pure JS, no DB calls.
        const eligible = candidates
          .map((row) => {
            const order = {
              id: row.id,
              status: row.status,
              fiscal_status: row.fiscal_status,
              delivery_date: row.delivery_date,
            };
            const company = {
              id: row.company_id,
              client_type: row.client_type,
              billing_term: row.billing_term,
              payment_dates: row.payment_dates,
              contract_start_date: row.contract_start_date,
              contract_end_date: row.contract_end_date,
            };
            const faturamento = getFaturamentoContext(company, order);
            if (!faturamento.podeEmitir) return null;
            return {
              orderId: row.id,
              companyId: row.company_id,
              faturamento: {
                tipo: faturamento.tipo,
                prazoDias: faturamento.prazoDias,
              },
            };
          })
          .filter(Boolean);

        return res.json(eligible);
      } catch (error) {
        console.error('[NFE_ELIGIBLE_ERROR]', error);
        return res.status(500).json({ error: 'Erro ao listar pedidos elegíveis' });
      }
    });

    // GET /api/nfe/cron/status — STEP 9.3D: status em memória do cron de faturamento
    app.get('/api/nfe/cron/status', requireAuthCore, requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]), (req: any, res) => {
      try {
        resolveTenant(req);
        logSecurityEvent({ type: "NFE_CRON_STATUS", userId: req.session?.userId, path: req.originalUrl, requestId: req.requestId });
        return res.json(getCronStatus());
      } catch (error) {
        console.error('[CRON_STATUS_ERROR]', error);
        return res.status(500).json({ error: 'Erro ao obter status do cron' });
      }
    });

    // POST /api/nfe/cron/run — STEP 9.3D: trigger manual do cron de faturamento
    app.post('/api/nfe/cron/run', sensitiveActionLimiter, requireAuthCore, requireRole(["MASTER", "ADMIN"]), async (req: any, res) => {
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
    // FASE MT-3A (M2): role gate added — cron history reveals orderId/timing
    // of NF-e batches across tenants; restrict to admin roles only.
    app.get('/api/nfe/cron/history', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER']), async (req: any, res) => {
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
    // MT-3C — cron_alert_logs is a system-level table (no tenant column);
    // cross-tenant by design, gated MASTER/ADMIN/DIRECTOR only.
    app.get(
      '/api/cron/alerts/logs',
      requireAuthCore,
      requireRole(['MASTER', 'ADMIN', 'DIRECTOR']),
      async (_req: any, res) => {
        try {
          void crossTenant(); // MT-3C: system-level log, no tenant discriminator
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
    // MT-3C — cron_alert_logs is a system-level table with no tenant column;
    // these reads are intentionally cross-tenant (MASTER/ADMIN/DIRECTOR only).
    app.get(
      '/api/cron/alerts/analytics',
      requireAuthCore,
      requireRole(['MASTER', 'ADMIN', 'DIRECTOR']),
      async (req: any, res) => {
        try {
          void crossTenant(); // MT-3C: system-level log, no tenant discriminator
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
    // C2-FIX: requireAuthCore + requireRole added — endpoints were publicly accessible
    // exposing internal fiscal idempotency telemetry without authentication.
    app.get('/api/nfe/dry-run/metrics', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR']), (req: any, res) => {
      const base = getDryRunMetrics();
      return res.json({
        ...base,
        topCompanies: getTopCompanies(),
      });
    });

    // GET /api/nfe/dry-run/metrics/window — STEP 9.2Z.1E: métricas filtradas por janela de tempo
    // Query: ?hours=24 (default 24h)
    // C2-FIX: requireAuthCore + requireRole added — same rationale as above.
    app.get('/api/nfe/dry-run/metrics/window', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR']), (req: any, res) => {
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
    app.post('/api/nfe/emitir', requireAuthCore, requireActiveSubscription, async (req: any, res) => {
      let lock: OrderLockHandle | null = null;
      try {
        const { orderId } = req.body;
        if (!orderId) return res.status(400).json({ message: 'orderId obrigatório' });

        logSecurity("[NFE_EMIT] order=" + orderId + " | user=" + req.session?.userId);

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
          // BUG-08-FIX: FAIL-CLOSED — if the period-closure guard itself throws,
          // block the emission. Emitting a NF-e into a closed fiscal period is an
          // irreversible compliance violation; being temporarily unavailable is
          // safer than silently bypassing the fiscal guard.
          console.error("[NFE_PERIOD_CLOSURE_CHECK_ERROR]", closeErr?.message);
          return res.status(503).json({
            message: "PERIOD_CLOSURE_CHECK_UNAVAILABLE",
            detail: "Verificação de fechamento de período indisponível. Tente novamente em instantes.",
          });
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
        console.log('[NFE_START]', { requestId: getRequestIdForLog(), company_id: tenantId, order_id: orderId, ambiente: input.tpAmb === '1' ? 'producao' : 'homologacao', ts: Date.now() });
        const gerada = await gerarNFeXML(input, numero);
        console.log('[NFE_XML_CREATED]', { requestId: getRequestIdForLog(), company_id: tenantId, order_id: orderId, chave: gerada.chaveNFe, numero, ts: Date.now() });

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

        // FLUXO UNIFICADO: quando não é mock, assina + valida XSD + transmite SEFAZ tudo aqui.
        // O status do pedido só é atualizado APÓS autorização confirmada pelo SEFAZ.
        const sefazModeEmit = (process.env.NFE_SEFAZ_MODE ?? 'mock').toLowerCase();
        if (sefazModeEmit !== 'mock') {
          // ETAPA 4 hardening: correlationId + per-step timing para observabilidade completa.
          // _nfeCorrId = requestId HTTP (mesmo ID usado em [NFE_START]/[NFE_XML_CREATED]).
          // Todos os logs do fluxo unificado carregam corrId para rastrear a emissão end-to-end.
          const _nfeTs0 = Date.now();
          const _nfeCorrId = getRequestIdForLog();
          let _nfeTs2: number | null = null; // timestamp após assinatura
          // 1. Resolver certificado: banco → env vars
          let certBase64ForSign: string | null = null;
          let certPwdForSign: string | null = null;
          try {
            const { companyCertificateRepository } = await import('../modules/companies/companyCertificate.repository.ts');
            const { decryptOrPassthrough } = await import('../utils/crypto.ts');
            const orderRow = await storage.getOrder(Number(orderId));
            const companyIdForCert: number | null = (orderRow?.order as any)?.companyId ?? (req.session as any)?.companyId ?? null;
            if (companyIdForCert) {
              const certRow = await companyCertificateRepository.getByCompanyId(companyIdForCert);
              if (certRow?.certBase64) {
                certBase64ForSign = certRow.certBase64;
                certPwdForSign = decryptOrPassthrough(certRow.certPassword);
                console.info(`[NFE_CERT_SOURCE] banco | nfeId=${nfe.id} | companyId=${companyIdForCert}`);
              }
            }
          } catch (dbCertErr: any) {
            console.warn('[NFE_CERT_DB_FAIL_EMITIR]', dbCertErr?.message);
          }
          if (!certBase64ForSign) {
            const envPath = process.env.CERT_PATH;
            const envPwd = process.env.CERT_PASSWORD;
            if (envPath && envPwd) {
              certBase64ForSign = envPath;
              certPwdForSign = envPwd;
              console.info(`[NFE_CERT_SOURCE] env | nfeId=${nfe.id}`);
            }
          }
          if (!certBase64ForSign || !certPwdForSign) {
            await storage.createLog({ action: 'NF-E_GERADA', description: `NF-e nº ${numero} gerada p/ pedido #${orderId} (sem cert — assinar manualmente).`, level: 'WARN', userId: req.session.userId });
            return res.status(201).json({ success: false, nfe, requiresCert: true, mensagem: 'XML NF-e gerado. Certificado digital não configurado — carregue o .pfx em Configurações Fiscais para assinar e transmitir ao SEFAZ.' });
          }

          // 2. Assinar XML
          let xmlParaEnviar = gerada.xmlGerado;
          try {
            const { assinarXML } = await import('../services/nfe/nfeSignature.ts');
            const { xmlAssinado } = await assinarXML(gerada.xmlGerado, certBase64ForSign, certPwdForSign);
            xmlParaEnviar = xmlAssinado;
            await storage.updateNfeEmissao(nfe.id, { status: 'assinada', xmlGerado: xmlParaEnviar });
            _nfeTs2 = Date.now();
            console.log('[NFE_SIGNED]', { corrId: _nfeCorrId, company_id: tenantId, order_id: orderId, nfe_id: nfe.id, chave: gerada.chaveNFe, stepMs: _nfeTs2 - _nfeTs0 });
          } catch (sigErr: any) {
            await storage.updateNfeEmissao(nfe.id, { status: 'erro' });
            console.error('[NFE_SIGN_FAILED]', { company_id: tenantId, order_id: orderId, nfe_id: nfe.id, error: sigErr?.message });
            return res.status(400).json({ message: `Erro na assinatura digital: ${sigErr.message}. Verifique o certificado e a senha.`, nfe });
          }

          // 3. Obter UF e transmitir ao SEFAZ (XSD local → SOAP → retry)
          const emitConfig = await storage.getCompanyConfig();
          const ufRaw = (emitConfig?.state ?? '').trim().toUpperCase();
          if (!ufRaw || !/^[A-Z]{2}$/.test(ufRaw)) {
            await storage.updateNfeEmissao(nfe.id, { status: 'erro' });
            return res.status(400).json({ message: 'UF do emitente não configurada ou inválida. Acesse Configurações Fiscais e informe o estado (UF) da empresa emissora.', nfe, campo: 'state' });
          }
          const tpAmbEnviar = nfe.ambienteFiscal === 'producao' ? '1' : '2';
          console.log('[NFE_SOAP_SENT]', { corrId: _nfeCorrId, company_id: tenantId, order_id: orderId, nfe_id: nfe.id, uf: ufRaw, tpAmb: tpAmbEnviar, ts: Date.now() });

          try {
            const { enviarNFeSEFAZ } = await import('../services/nfe/nfeSender.ts');
            const _nfeTs3 = Date.now();
            const retorno = await enviarNFeSEFAZ(xmlParaEnviar, ufRaw, tpAmbEnviar);
            const _nfeSefazMs = Date.now() - _nfeTs3;
            console.log('[NFE_SEFAZ_RESPONSE]', { corrId: _nfeCorrId, company_id: tenantId, order_id: orderId, nfe_id: nfe.id, cStat: retorno.cStat, xMotivo: retorno.xMotivo, protocolo: retorno.protocolo, sefazMs: _nfeSefazMs });

            const updates: Record<string, any> = { status: retorno.status, cStat: retorno.cStat, xMotivo: retorno.xMotivo };
            if (retorno.status === 'autorizada') {
              updates.protocolo = retorno.protocolo;
              updates.dataAutorizacao = retorno.dataAutorizacao ? new Date(retorno.dataAutorizacao) : new Date();
              updates.xmlAutorizado = retorno.xmlAutorizado || xmlParaEnviar;
              // Atualizar pedido SOMENTE após autorização SEFAZ confirmada
              await storage.updateOrder(Number(orderId), { fiscalStatus: 'nota_emitida' });
              console.log('[NFE_AUTHORIZED]', { corrId: _nfeCorrId, company_id: tenantId, order_id: orderId, nfe_id: nfe.id, chave: gerada.chaveNFe, cStat: retorno.cStat, protocolo: retorno.protocolo, ambiente: nfe.ambienteFiscal, totalMs: Date.now() - _nfeTs0 });
            } else {
              console.log('[NFE_REJECTED]', { corrId: _nfeCorrId, company_id: tenantId, order_id: orderId, nfe_id: nfe.id, cStat: retorno.cStat, xMotivo: retorno.xMotivo, sefazMs: _nfeSefazMs });
            }

            // ETAPA 3 hardening — FAIL-SAFE pós-autorização.
            // Se updateNfeEmissao lançar APÓS o SEFAZ ter autorizado a nota,
            // a NF-e está registrada no fisco mas não no banco. Logar TODOS os dados
            // para recuperação manual. Nunca silenciar esta falha.
            try {
              await storage.updateNfeEmissao(nfe.id, updates);
              console.log('[NFE_DB_PERSISTED]', { corrId: _nfeCorrId, company_id: tenantId, order_id: orderId, nfe_id: nfe.id, status: retorno.status, totalMs: Date.now() - _nfeTs0 });
            } catch (persistErr: any) {
              console.error('[NFE_PERSIST_CRITICAL_ALERT]', {
                corrId: _nfeCorrId,
                ACAO_NECESSARIA: 'Recuperação manual obrigatória — NF-e autorizada pelo SEFAZ mas não persisitida no banco',
                company_id: tenantId,
                order_id: orderId,
                nfe_id: nfe.id,
                chave: gerada.chaveNFe,
                protocolo: retorno.protocolo,
                cStat: retorno.cStat,
                xMotivo: retorno.xMotivo,
                status: retorno.status,
                dataAutorizacao: retorno.dataAutorizacao,
                xmlAutorizadoLen: (retorno.xmlAutorizado || xmlParaEnviar)?.length,
                persistError: persistErr?.message,
              });
              return res.status(201).json({
                success: retorno.status === 'autorizada',
                nfe: { ...nfe, status: retorno.status, cStat: retorno.cStat, xMotivo: retorno.xMotivo, protocolo: retorno.protocolo },
                retorno: { status: retorno.status, cStat: retorno.cStat, xMotivo: retorno.xMotivo, protocolo: retorno.protocolo, chaveNFe: retorno.chaveNFe || gerada.chaveNFe },
                mensagem: `NF-e ${retorno.status === 'autorizada' ? 'autorizada' : retorno.status} pelo SEFAZ mas falhou ao persistir. Acione o suporte com corrId=${_nfeCorrId}`,
                persistWarning: true,
              });
            }

            await storage.createLog({
              action: retorno.status === 'autorizada' ? 'NF-E_AUTORIZADA' : 'NF-E_REJEITADA',
              description: `NF-e nº ${numero} ${retorno.status === 'autorizada' ? 'autorizada' : 'rejeitada'} pelo SEFAZ. Pedido #${orderId}. cStat=${retorno.cStat}. ${retorno.xMotivo}`,
              level: retorno.status === 'autorizada' ? 'INFO' : 'WARN',
              userId: req.session.userId,
            });

            // Email automático após autorização
            if (retorno.status === 'autorizada') {
              try {
                const { sendNFeAutorizadaEmail } = await import('../services/mailer.ts');
                const orderData = await storage.getOrder(Number(orderId));
                const config = await storage.getCompanyConfig();
                const destinos: string[] = [];
                if (config?.email) destinos.push(config.email);
                const orderCompany = orderData ? await storage.getCompany((orderData.order as any).companyId) : null;
                if (orderCompany?.email) destinos.push(orderCompany.email);
                const xmlContent = retorno.xmlAutorizado || xmlParaEnviar;
                for (const email of destinos) {
                  await sendNFeAutorizadaEmail({ toEmail: email, nfeNumero: Number(nfe.numero), chaveNFe: nfe.chaveNFe || '', protocolo: retorno.protocolo || '', orderId: Number(orderId), xmlContent });
                }
              } catch (emailErr: any) {
                console.error('[EMAIL] Falha ao enviar email NF-e autorizada:', emailErr.message);
              }
            }

            // ETAPA 4 hardening — Timeline summary: duração de cada etapa do fluxo unificado.
            console.log('[NFE_EMISSION_TIMELINE]', {
              corrId: _nfeCorrId,
              company_id: tenantId,
              order_id: orderId,
              nfe_id: nfe.id,
              chave: gerada.chaveNFe,
              status: retorno.status,
              ambiente: nfe.ambienteFiscal,
              timings: {
                xmlMs: _nfeTs2 != null ? _nfeTs2 - _nfeTs0 : null,
                signMs: _nfeTs2 != null ? _nfeTs3 - _nfeTs2 : null,
                sefazMs: _nfeSefazMs,
                totalMs: Date.now() - _nfeTs0,
              },
            });

            const nfeAtualizada = await storage.getNfeEmissao(nfe.id);
            return res.status(201).json({
              success: retorno.status === 'autorizada',
              nfe: nfeAtualizada,
              retorno: {
                status: retorno.status,
                cStat: retorno.cStat,
                xMotivo: retorno.xMotivo,
                protocolo: retorno.protocolo,
                chaveNFe: retorno.chaveNFe || gerada.chaveNFe,
              },
              mensagem: retorno.status === 'autorizada'
                ? `NF-e nº ${numero} autorizada pelo SEFAZ (cStat=${retorno.cStat})`
                : `NF-e nº ${numero} ${retorno.status} pelo SEFAZ: ${retorno.xMotivo} (cStat=${retorno.cStat})`,
            });
          } catch (sefazErr: any) {
            if (sefazErr?.code === 'NFE_XSD_INVALID') {
              await storage.updateNfeEmissao(nfe.id, { status: 'erro' });
              return res.status(422).json({
                message: 'Falha na validação do schema NF-e 4.00 (XML inválido — transmissão bloqueada)',
                code: 'NFE_XSD_INVALID',
                xsdErrors: sefazErr.xsdErrors ?? [],
                nfe,
              });
            }
            await storage.updateNfeEmissao(nfe.id, { status: 'erro' });
            console.error('[NFE_SEFAZ_SEND_FAILED]', { corrId: _nfeCorrId, company_id: tenantId, order_id: orderId, nfe_id: nfe.id, error: sefazErr?.message, totalMs: Date.now() - _nfeTs0 });
            return res.status(500).json({ message: `Falha ao transmitir ao SEFAZ: ${sefazErr.message}`, nfe });
          }
        }

        // MODO MOCK: atualiza pedido imediatamente, sem transmissão real
        await storage.updateOrder(Number(orderId), { fiscalStatus: 'nota_emitida' });
        await storage.createLog({ action: 'NF-E_GERADA', description: `NF-e nº ${numero} gerada para pedido #${orderId}. Chave: ${gerada.chaveNFe}`, level: 'INFO', userId: req.session.userId });
        res.status(201).json({ success: true, nfe, mensagem: 'XML NF-e gerado [MOCK]. Use /api/nfe/:id/enviar para transmitir ao SEFAZ.' });
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
    app.post('/api/nfe/:orderId/reenviar', requireAuthCore, requireActiveSubscription, async (req: any, res) => {
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
    app.post('/api/nfe/:orderId/corrigir-reenviar', requireAuthCore, requireActiveSubscription, async (req: any, res) => {
      let lock: OrderLockHandle | null = null;
      const orderIdRaw = req.params?.orderId;
      const orderId = Number(orderIdRaw);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).json({ message: 'orderId inválido' });
      }
      logSecurity("[NFE_OVERRIDE] order=" + orderId + " | user=" + req.session?.userId);
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
    app.get('/api/nfe/:orderId/historico', requireAuthCore, requireActiveSubscription, async (req: any, res) => {
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
    app.post('/api/nfe/emitir-lote', requireAuthCore, requireActiveSubscription, async (req: any, res) => {
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
    app.post('/api/nfe/:id/enviar', requireAuthCore, async (req: any, res) => {
      try {
        const nfe = await storage.getNfeEmissao(Number(req.params.id));
        if (!nfe) return res.status(404).json({ message: 'NF-e não encontrada' });
        if (!nfe.xmlGerado) return res.status(400).json({ message: 'XML não gerado. Emita a NF-e primeiro.' });

        // FASE 3 — bloqueia transmissão de NF de outro tenant antes de qualquer ação.
        if (nfe.orderId) await validateOrderTenant(nfe.orderId);

        // FASE NF.3 — modo controlado: 'mock' usa transmissor simulado; qualquer outro valor
        // ('homologacao', 'producao') usa o fluxo real de assinatura + XSD + SOAP SEFAZ.
        const sefazMode = (process.env.NFE_SEFAZ_MODE ?? 'mock').toLowerCase();
        if (sefazMode === 'mock') {
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

        // Resolve certificado: banco (company_certificates) > CERT_PATH env > CERT_PASSWORD env
        let certBase64ForSign: string | null = null;
        let certPwdForSign: string | null = null;

        // Fonte 1: certificado salvo no banco via interface (POST /api/company/certificate)
        try {
          const { companyCertificateRepository } = await import('../modules/companies/companyCertificate.repository.ts');
          const { decryptOrPassthrough } = await import('../utils/crypto.ts');
          // Resolve companyId: do pedido vinculado ou do tenant da sessão
          let companyIdForCert: number | null = null;
          if (nfe.orderId) {
            const orderRow = await storage.getOrder(nfe.orderId);
            companyIdForCert = (orderRow?.order as any)?.companyId ?? null;
          }
          if (!companyIdForCert) companyIdForCert = (req.session as any)?.companyId ?? null;
          if (companyIdForCert) {
            const certRow = await companyCertificateRepository.getByCompanyId(companyIdForCert);
            if (certRow?.certBase64) {
              certBase64ForSign = certRow.certBase64;
              certPwdForSign = decryptOrPassthrough(certRow.certPassword);
              console.info(`[NFE_CERT_SOURCE] banco | nfeId=${nfe.id} | companyId=${companyIdForCert}`);
            }
          }
        } catch (dbCertErr: any) {
          console.warn('[NFE_CERT_DB_FAIL]', dbCertErr?.message);
        }

        // Fonte 2: env vars (CERT_PATH aceita caminho em disco OU string base64)
        if (!certBase64ForSign) {
          const envPath = process.env.CERT_PATH;
          const envPwd = process.env.CERT_PASSWORD;
          if (envPath && envPwd) {
            certBase64ForSign = envPath;
            certPwdForSign = envPwd;
            console.info(`[NFE_CERT_SOURCE] env | nfeId=${nfe.id}`);
          }
        }

        if (!certBase64ForSign || !certPwdForSign) {
          return res.status(400).json({
            message: 'Certificado digital não configurado. Carregue o arquivo .pfx em Configurações Fiscais ou defina as variáveis CERT_PATH e CERT_PASSWORD.',
            nfe,
            dica: 'Acesse Configurações Fiscais → Certificado Digital A1 e carregue o arquivo .pfx emitido pela ICP-Brasil.',
          });
        }

        let xmlParaEnviar = nfe.xmlGerado;
        try {
          const { assinarXML } = await import('../services/nfe/nfeSignature.ts');
          const { xmlAssinado } = await assinarXML(nfe.xmlGerado, certBase64ForSign, certPwdForSign);
          xmlParaEnviar = xmlAssinado;
          await storage.updateNfeEmissao(nfe.id, { status: 'assinada', xmlGerado: xmlParaEnviar });
        } catch (sigErr: any) {
          return res.status(400).json({ message: `Erro na assinatura digital: ${sigErr.message}. Verifique o certificado e a senha.` });
        }

        // T1003 — UF dinâmica real do emitente (companyConfig.state).
        // T1004 — rejeita envio com UF ausente ou inválida; sem fallback silencioso.
        const emitConfig = await storage.getCompanyConfig();
        const ufRaw = (emitConfig?.state ?? '').trim().toUpperCase();
        if (!ufRaw || !/^[A-Z]{2}$/.test(ufRaw)) {
          console.error(
            `[NFE_UF_MISSING] requestId=${getRequestIdForLog()} | nfeId=${nfe.id} | orderId=${nfe.orderId} | state=${JSON.stringify(emitConfig?.state)}`,
          );
          return res.status(400).json({
            message: 'UF do emitente não configurada ou inválida. Acesse Configurações Fiscais e informe o estado (UF) da empresa emissora.',
            campo: 'state',
          });
        }
        const uf = ufRaw;
        const tpAmb = nfe.ambienteFiscal === 'producao' ? '1' : '2';
        console.info(
          `[NFE_ENVIAR] requestId=${getRequestIdForLog()} | nfeId=${nfe.id} | uf=${uf} | tpAmb=${tpAmb} | orderId=${nfe.orderId}`,
        );
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
      } catch (e: any) {
        // FASE 1.8 — Erro de validação XSD local: retorna 422 com todos os detalhes
        if (e?.code === 'NFE_XSD_INVALID') {
          return res.status(422).json({
            message: 'Falha na validação do schema NF-e 4.00 (XML inválido — transmissão bloqueada)',
            code: 'NFE_XSD_INVALID',
            xsdErrors: e.xsdErrors ?? [],
            hint: 'Verifique os erros XSD em /tmp/nfe-debug/xsd-errors.json',
          });
        }
        res.status(500).json({ message: e.message });
      }
    });

    // GET /api/nfe/:id/danfe — baixar PDF
    // T1104 — fonte da verdade: xmlAutorizado → xmlGerado. Nunca reconstrói do pedido.
    // Juridicamente válido: o conteúdo do DANFE reflecte exactamente o XML autorizado pela SEFAZ.
    app.get('/api/nfe/:id/danfe', requireAuthCore, async (req: any, res) => {
      try {
        const nfe = await storage.getNfeEmissao(Number(req.params.id));
        if (!nfe) return res.status(404).json({ message: 'NF-e não encontrada' });

        // FASE 3 — garante que pertence ao tenant.
        if (nfe.orderId) await validateOrderTenant(nfe.orderId);

        // T1104 — usa XML persistido como única fonte da verdade (juridicamente válido).
        // Prioridade: xmlAutorizado (SEFAZ-validated) → xmlGerado (before auth) → erro.
        // Nunca chama buildNFeInput() pois o estado do pedido pode ter mudado após a emissão.
        const xml = nfe.xmlAutorizado || nfe.xmlGerado;
        if (!xml) {
          return res.status(400).json({
            message: 'DANFE indisponível: XML NF-e não encontrado. Emita a NF-e primeiro.',
            code: 'NFE_XML_MISSING',
          });
        }

        const danfeData = parseXmlToDanfeData(xml);
        const pdfBuffer = await gerarDANFE(danfeData);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="DANFE_NF-e_${nfe.numero}.pdf"`);
        res.send(pdfBuffer);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/nfe/:id/xml — baixar XML
    app.get('/api/nfe/:id/xml', requireAuthCore, async (req: any, res) => {
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
    app.get('/api/nfe/fiscal-data/:orderId', requireAuthCore, async (req: any, res) => {
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
    app.get('/api/nfe/diagnostics/:orderId', requireAuthCore, tenantContext, async (req: any, res) => {
      try {
        // FASE 6 — diagnóstico de NF-e expõe dados sensíveis do pedido;
        // bloqueia se for de outro tenant.
        // FASE 12.2.2 — tenantContext middleware adicionado: admins podem usar
        // ?empresaId=N para identificar o tenant alvo sem quebrar multi-tenant.
        await validateOrderTenant(Number(req.params.orderId));
        const { validateNFeBeforeSend } = await import('../services/nfe/diagnostics/nfe-validator.ts');
        const result = await validateNFeBeforeSend(Number(req.params.orderId));
        res.json(result);
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    });

    // POST /api/nfe/diagnostics/log-error — registrar erro + solução no training
    app.post('/api/nfe/diagnostics/log-error', requireAuthCore, async (req: any, res) => {
      try {
        const { logNFeError } = await import('../services/nfe/diagnostics/nfe-training.ts');
        const record = await logNFeError({ ...req.body, userId: req.session.userId });
        res.status(201).json(record);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/nfe/diagnostics/log-errors — registrar múltiplos erros de validação
    app.post('/api/nfe/diagnostics/log-errors', requireAuthCore, async (req: any, res) => {
      try {
        const { logNFeErrors } = await import('../services/nfe/diagnostics/nfe-training.ts');
        const { errors, orderId, nfeId } = req.body;
        const records = await logNFeErrors(errors || [], { orderId, nfeId, userId: req.session.userId });
        res.status(201).json(records);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/nfe/diagnostics/training/logs — logs de treinamento
    app.get('/api/nfe/diagnostics/training/logs', requireAuthCore, async (req: any, res) => {
      try {
        const limit = req.query.limit ? Number(req.query.limit) : 100;
        const orderId = req.query.orderId ? Number(req.query.orderId) : undefined;
        const logs = await storage.getNfeTrainingLogs({ orderId, limit });
        res.json(logs);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/nfe/diagnostics/training/patterns — padrões aprendidos
    app.get('/api/nfe/diagnostics/training/patterns', requireAuthCore, async (req: any, res) => {
      try {
        const { getLearnedPatterns } = await import('../services/nfe/diagnostics/nfe-training.ts');
        res.json(await getLearnedPatterns());
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // PATCH /api/nfe/diagnostics/training/:id/resolve — marcar erro como resolvido
    app.patch('/api/nfe/diagnostics/training/:id/resolve', requireAuthCore, async (req: any, res) => {
      try {
        const { markNFeErrorResolved } = await import('../services/nfe/diagnostics/nfe-training.ts');
        const record = await markNFeErrorResolved(Number(req.params.id));
        res.json(record);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // ── FASE 8.6E — MÉTRICAS DE DEFAULTS FISCAIS (in-memory) ─────────────────
    // Telemetria das ocorrências de `[FISCAL_DEFAULT_APPLIED]` (uCom/csosn/cst).
    // Apenas leitura — não toca builder, não bloqueia emissão, não usa banco.
    app.get('/api/admin/nfe/fiscal-defaults', requireAuthCore, async (req: any, res) => {
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
    app.post('/api/admin/nfe/fiscal-defaults/reset', requireAuthCore, async (req: any, res) => {
      try {
        resetFiscalDefaultsStats();
        res.json({ ok: true });
      } catch (err: any) {
        console.error('[ADMIN_FISCAL_DEFAULTS_RESET_ERROR]', err);
        res.status(500).json({ ok: false, message: err?.message });
      }
    });

    // ════════════════════════════════════════════════════════════════════════
    // RECOVERY — identificação e recuperação operacional de NF-es travadas
    //   GET  /api/admin/nfe/recovery                  — scan read-only
    //   POST /api/admin/nfe/recovery/:id/reprocess    — reenvio seguro
    //   POST /api/admin/nfe/recovery/:id/mark-error   — marcar erro seguro
    // ════════════════════════════════════════════════════════════════════════

    app.get('/api/admin/nfe/recovery', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER']), async (req: any, res) => {
      const corrId = getRequestIdForLog();
      try {
        const { scanForRecovery } = await import('../modules/nfe/nfe-recovery.service.ts');
        const result = await scanForRecovery();
        console.log('[NFE_RECOVERY_SCAN]', {
          corrId,
          total: result.total,
          by_risco: result.by_risco,
          scanned_at: result.scanned_at,
        });
        // [NFE_RECOVERY_FOUND] — um log por item encontrado (spec ETAPA 6)
        for (const item of result.items) {
          const label = item.risco === 'CRITICAL' ? '[NFE_RECOVERY_CRITICAL]' : '[NFE_RECOVERY_FOUND]';
          console.log(label, {
            corrId,
            nfe_id: item.nfe_id,
            order_id: item.order_id,
            chave: item.chave,
            status: item.status,
            recovery_type: item.recovery_type,
            risco: item.risco,
            idade_min: item.idade_min,
            ambiente: item.ambiente,
          });
        }
        res.json({ ok: true, ...result });
      } catch (err: any) {
        console.error('[NFE_RECOVERY_SCAN_ERROR]', { corrId, error: err?.message });
        res.status(500).json({ ok: false, message: err?.message });
      }
    });

    // POST /api/admin/nfe/recovery/:id/reprocess
    // Reenvia ao SEFAZ uma NF-e travada em 'assinada' ou 'enviando' com XML disponível.
    // Protegido por: advisory lock + idempotência + validação de status.
    // PROIBIDO: reenviar autorizada, duplicar chave, alterar ambiente.
    app.post('/api/admin/nfe/recovery/:id/reprocess', requireAuthCore, requireRole(['MASTER', 'ADMIN']), async (req: any, res) => {
      const corrId = getRequestIdForLog();
      const nfeId = Number(req.params.id);
      if (!Number.isFinite(nfeId) || nfeId <= 0) {
        return res.status(400).json({ ok: false, message: 'nfeId inválido' });
      }
      let lock: OrderLockHandle | null = null;
      let lockOrderId: number | null = null;
      let lockTenantId: number | null = null;
      try {
        const nfe = await storage.getNfeEmissao(nfeId);
        if (!nfe) return res.status(404).json({ ok: false, message: 'NF-e não encontrada' });

        // ETAPA 7 — Fail safety: nunca reprocessar autorizada/cancelada/denegada
        if (['autorizada', 'cancelada', 'denegada'].includes(nfe.status)) {
          return res.status(409).json({
            ok: false,
            message: `NF-e em status "${nfe.status}" não é reprocessável. Dados fiscais imutáveis.`,
          });
        }
        // Apenas assinada/enviando têm XML assinado pronto para reenvio
        if (!['assinada', 'enviando'].includes(nfe.status)) {
          return res.status(409).json({
            ok: false,
            message: `Status "${nfe.status}" não é recuperável via reprocess. Use /mark-error e reemita pelo fluxo normal.`,
          });
        }
        if (!nfe.xmlGerado) {
          return res.status(422).json({
            ok: false,
            message: 'XML assinado ausente. Não é possível reprocessar sem XML. Use /mark-error e reemita.',
          });
        }

        // Obter tenantId via order.companyId para lock consistente com o fluxo normal
        const orderData = await storage.getOrder(nfe.orderId);
        const tenantId: number = (orderData?.order as any)?.companyId ?? 0;
        if (!Number.isInteger(tenantId) || tenantId <= 0) {
          return res.status(400).json({ ok: false, message: 'Não foi possível determinar tenant para lock.' });
        }
        lockOrderId = nfe.orderId;
        lockTenantId = tenantId;

        // ETAPA 4 — Advisory lock antes de qualquer escrita
        lock = await acquireOrderLock(tenantId, nfe.orderId);
        if (!lock) {
          console.warn('[NFE_RECOVERY_LOCK_SKIPPED]', { corrId, nfe_id: nfeId, order_id: nfe.orderId, tenantId });
          return res.status(409).json({ ok: false, message: 'Pedido em processamento — lock não adquirido. Tente novamente em instantes.' });
        }
        console.log('[NFE_RECOVERY_REPROCESS]', {
          corrId, nfe_id: nfeId, order_id: nfe.orderId, status: nfe.status,
          chave: nfe.chaveNFe, tenantId, userId: req.session?.userId,
        });

        // Verificar idempotência: existe autorização para este pedido?
        const existing = await storage.getNfeEmissaoByOrderId(nfe.orderId);
        if (existing && existing.id !== nfeId && existing.status === 'autorizada') {
          console.warn('[NFE_RECOVERY_IDEM_BLOCKED]', { corrId, nfe_id: nfeId, existing_id: existing.id, order_id: nfe.orderId });
          return res.status(409).json({
            ok: false,
            message: `Pedido já possui NF-e autorizada (id=${existing.id}, chave=${existing.chaveNFe}). Reprocessamento bloqueado.`,
          });
        }

        // Obter UF do emitente
        const config = await storage.getCompanyConfig();
        const ufRaw = (config?.state ?? '').trim().toUpperCase();
        if (!ufRaw || !/^[A-Z]{2}$/.test(ufRaw)) {
          return res.status(400).json({ ok: false, message: 'UF do emitente não configurada em Configurações Fiscais.' });
        }
        const tpAmb: '1' | '2' = nfe.ambienteFiscal === 'producao' ? '1' : '2';

        // Marcar enviando antes de transmitir
        await storage.updateNfeEmissao(nfeId, { status: 'enviando' });

        const { enviarNFeSEFAZ } = await import('../services/nfe/nfeSender.ts');
        const _t0 = Date.now();
        const retorno = await enviarNFeSEFAZ(nfe.xmlGerado, ufRaw, tpAmb);
        const sefazMs = Date.now() - _t0;

        const updates: Record<string, any> = { status: retorno.status, cStat: retorno.cStat, xMotivo: retorno.xMotivo };
        if (retorno.status === 'autorizada') {
          updates.protocolo = retorno.protocolo;
          updates.dataAutorizacao = retorno.dataAutorizacao ? new Date(retorno.dataAutorizacao) : new Date();
          updates.xmlAutorizado = retorno.xmlAutorizado || nfe.xmlGerado;
          await storage.updateOrder(nfe.orderId, { fiscalStatus: 'nota_emitida' });
        }

        // ETAPA 3 fail-safe: catch isolado pós-autorização para não perder dados
        try {
          await storage.updateNfeEmissao(nfeId, updates);
        } catch (persistErr: any) {
          console.error('[NFE_RECOVERY_PERSIST_CRITICAL]', {
            corrId, nfe_id: nfeId, order_id: nfe.orderId,
            chave: nfe.chaveNFe, protocolo: retorno.protocolo,
            cStat: retorno.cStat, status: retorno.status,
            ACAO_NECESSARIA: 'Persistência falhou após autorização — recuperação manual',
            persistError: persistErr?.message,
          });
        }

        const logLabel = retorno.status === 'autorizada' ? '[NFE_RECOVERY_SUCCESS]' : '[NFE_RECOVERY_REPROCESS]';
        console.log(logLabel, {
          corrId, nfe_id: nfeId, order_id: nfe.orderId,
          chave: nfe.chaveNFe, status: retorno.status,
          cStat: retorno.cStat, protocolo: retorno.protocolo,
          sefazMs, ambiente: nfe.ambienteFiscal,
        });

        await storage.createLog({
          action: retorno.status === 'autorizada' ? 'NFE_RECOVERY_SUCCESS' : 'NFE_RECOVERY_REPROCESS',
          description: `Recovery NF-e id=${nfeId} pedido #${nfe.orderId}: ${retorno.status} (cStat=${retorno.cStat})`,
          level: retorno.status === 'autorizada' ? 'INFO' : 'WARN',
          userId: req.session?.userId,
        });

        const nfeAtualizada = await storage.getNfeEmissao(nfeId);
        return res.status(200).json({
          ok: true,
          success: retorno.status === 'autorizada',
          nfe: nfeAtualizada,
          retorno: { status: retorno.status, cStat: retorno.cStat, xMotivo: retorno.xMotivo, protocolo: retorno.protocolo, chaveNFe: retorno.chaveNFe || nfe.chaveNFe },
          mensagem: `Recovery: NF-e ${retorno.status === 'autorizada' ? 'autorizada' : retorno.status} (cStat=${retorno.cStat})`,
        });
      } catch (err: any) {
        try { await storage.updateNfeEmissao(nfeId, { status: 'erro' }); } catch {}
        console.error('[NFE_RECOVERY_FAILED]', { corrId, nfe_id: nfeId, error: err?.message });
        return res.status(500).json({ ok: false, message: `Falha no recovery: ${err?.message}` });
      } finally {
        if (lock) {
          await releaseOrderLock(lock);
          console.log('[NFE_RECOVERY_LOCK_RELEASED]', { corrId, nfe_id: nfeId, order_id: lockOrderId, tenantId: lockTenantId });
        }
      }
    });

    // POST /api/admin/nfe/recovery/:id/mark-error
    // Marca NF-e como erro de forma segura, preservando TODOS os dados existentes.
    // PROIBIDO: usar em autorizada/cancelada. Preserva XML, protocolo, cStat, SOAP.
    app.post('/api/admin/nfe/recovery/:id/mark-error', requireAuthCore, requireRole(['MASTER', 'ADMIN']), async (req: any, res) => {
      const corrId = getRequestIdForLog();
      const nfeId = Number(req.params.id);
      if (!Number.isFinite(nfeId) || nfeId <= 0) {
        return res.status(400).json({ ok: false, message: 'nfeId inválido' });
      }
      try {
        const nfe = await storage.getNfeEmissao(nfeId);
        if (!nfe) return res.status(404).json({ ok: false, message: 'NF-e não encontrada' });

        // ETAPA 7 — Imutabilidade: nunca sobrescrever autorizada/cancelada/denegada
        if (['autorizada', 'cancelada', 'denegada'].includes(nfe.status)) {
          return res.status(409).json({
            ok: false,
            message: `NF-e em status "${nfe.status}" não pode ser marcada como erro. Dados fiscais imutáveis.`,
          });
        }

        const { motivo } = req.body as { motivo?: string };
        const motivoFinal = motivo?.trim() || `Marcada como erro manualmente via recovery (corrId=${corrId})`;

        // Preserva XML, protocolo, c_stat, chave — apenas muda status e xMotivo
        await storage.updateNfeEmissao(nfeId, {
          status: 'erro',
          xMotivo: motivoFinal,
        });

        console.log('[NFE_RECOVERY_MANUAL]', {
          corrId, nfe_id: nfeId, order_id: nfe.orderId,
          chave: nfe.chaveNFe, status_anterior: nfe.status,
          motivo: motivoFinal, userId: req.session?.userId,
          ambiente: nfe.ambienteFiscal,
        });

        await storage.createLog({
          action: 'NFE_RECOVERY_MANUAL_ERROR',
          description: `Recovery mark-error NF-e id=${nfeId} pedido #${nfe.orderId}: ${nfe.status} → erro. Motivo: ${motivoFinal}`,
          level: 'WARN',
          userId: req.session?.userId,
        });

        const nfeAtualizada = await storage.getNfeEmissao(nfeId);
        return res.status(200).json({
          ok: true,
          nfe: nfeAtualizada,
          mensagem: `NF-e marcada como erro. Status anterior: ${nfe.status}.`,
        });
      } catch (err: any) {
        console.error('[NFE_RECOVERY_MARK_ERROR_FAILED]', { corrId, nfe_id: nfeId, error: err?.message });
        return res.status(500).json({ ok: false, message: err?.message });
      }
    });

    // GET /api/nfe/sefaz/status — status do serviço SEFAZ
    app.get('/api/nfe/sefaz/status', requireAuthCore, async (req: any, res) => {
      try {
        const config = await storage.getCompanyConfig();
        const tpAmb = config?.ambienteFiscal === 'producao' ? '1' : '2';
        // T1003/T1004 — usar UF real do emitente; fallback para SP apenas
        // neste endpoint de status (somente leitura, sem impacto fiscal).
        const ufStatus = (config?.state ?? '').trim().toUpperCase() || 'SP';
        if (!/^[A-Z]{2}$/.test(ufStatus)) {
          return res.status(400).json({ message: 'UF do emitente inválida. Configure o estado em Configurações Fiscais.', online: false });
        }
        const result = await consultarStatusSEFAZ(ufStatus, tpAmb as '1' | '2');
        res.json({ ...result, uf: ufStatus, ambiente: tpAmb === '1' ? 'producao' : 'homologacao' });
      } catch (e: any) { res.status(500).json({ message: e.message, online: false }); }
    });

    // DELETE /api/nfe/:id — cancelar NF-e
    // T1102 — cancelamento REAL na SEFAZ com validações legais e persistência completa.
    app.delete('/api/nfe/:id', requireAuthCore, async (req: any, res) => {
      const requestId = getRequestIdForLog();
      try {
        const { motivo } = req.body;
        const nfe = await storage.getNfeEmissao(Number(req.params.id));
        if (!nfe) return res.status(404).json({ message: 'NF-e não encontrada' });

        // FASE 6 — bloqueia cancelamento de NF-e de outro tenant.
        if (nfe.orderId) {
          try {
            await validateOrderTenant(nfe.orderId);
          } catch (e: any) {
            if (e instanceof AppError) return res.status(e.status).json({ message: e.message });
            throw e;
          }
        }

        // T1102 — guard: apenas NF-e AUTORIZADA pode ser cancelada
        if (nfe.status !== 'autorizada') {
          return res.status(422).json({
            success: false,
            code: 'NFE_CANCEL_INVALID_STATUS',
            message: `Cancelamento bloqueado: NF-e está com status '${nfe.status}'. Somente NF-e AUTORIZADA pode ser cancelada.`,
          });
        }

        // T1102 — idempotência: já cancelada na SEFAZ
        if (nfe.protocoloCancelamento) {
          return res.status(409).json({
            success: false,
            code: 'NFE_CANCEL_DUPLICATE',
            message: 'Cancelamento já registrado na SEFAZ para esta NF-e.',
            protocoloCancelamento: nfe.protocoloCancelamento,
          });
        }

        // T1102 — janela legal: 168h (7 dias) após autorização
        const MAX_CANCEL_HOURS = 168;
        if (nfe.dataAutorizacao) {
          const diffHours = (Date.now() - new Date(nfe.dataAutorizacao).getTime()) / (1000 * 60 * 60);
          if (diffHours > MAX_CANCEL_HOURS) {
            return res.status(422).json({
              success: false,
              code: 'NFE_CANCEL_TIME_EXPIRED',
              message: `Cancelamento fora da janela legal (${MAX_CANCEL_HOURS}h após autorização). Prazo encerrado.`,
            });
          }
        }

        // T1102 — campos obrigatórios para o evento SEFAZ
        if (!nfe.chaveNFe) {
          return res.status(400).json({ success: false, code: 'NFE_CANCEL_MISSING_CHAVE', message: 'Chave NF-e ausente. Não é possível cancelar.' });
        }
        if (!nfe.protocolo) {
          return res.status(400).json({ success: false, code: 'NFE_CANCEL_MISSING_PROTOCOLO', message: 'Protocolo de autorização ausente. Não é possível cancelar.' });
        }

        const xJust = ((motivo as string) || 'Cancelamento solicitado pelo emitente').trim();
        if (xJust.length < 15) {
          return res.status(400).json({ success: false, code: 'NFE_CANCEL_MOTIVO_INVALIDO', message: 'Motivo de cancelamento inválido (mínimo 15 caracteres).' });
        }

        const emitConfig = await storage.getCompanyConfig();
        const uf = (emitConfig?.state ?? 'SP').trim().toUpperCase();
        const cnpjEmit = (emitConfig?.cnpj ?? '').replace(/\D/g, '');
        const tpAmb: '1' | '2' = nfe.ambienteFiscal === 'producao' ? '1' : '2';

        logSecurity(`[NFE_CANCELAMENTO] requestId=${requestId} | nfeId=${nfe.id} | chave=${nfe.chaveNFe} | uf=${uf} | tpAmb=${tpAmb} | user=${req.session?.userId}`);

        const { cancelarNFe } = await import('../services/nfe/nfeSender.ts');
        const retorno = await cancelarNFe(nfe.chaveNFe, nfe.protocolo, xJust, uf, cnpjEmit, tpAmb);

        // cStat de sucesso: 135=vinculado, 155=cancelamento homologação, 101=cancelamento de NF-e
        const CANCEL_SUCCESS = new Set(['101', '135', '155']);
        if (!CANCEL_SUCCESS.has(retorno.cStat)) {
          logSecurity(`[NFE_CANCELAMENTO_REJEITADO] requestId=${requestId} | nfeId=${nfe.id} | cStat=${retorno.cStat} | xMotivo=${retorno.xMotivo}`);
          return res.status(422).json({
            success: false,
            code: 'NFE_CANCEL_REJECTED',
            cStat: retorno.cStat,
            xMotivo: retorno.xMotivo,
            message: `Cancelamento rejeitado pela SEFAZ: ${retorno.xMotivo} (cStat=${retorno.cStat})`,
          });
        }

        // T1102 — persiste cancelamento com todos os dados do evento SEFAZ
        await storage.updateNfeEmissao(nfe.id, {
          status: 'cancelada',
          motivoCancelamento: xJust,
          protocoloCancelamento: retorno.protocolo || null,
          xmlCancelamento: retorno.xmlEvento || null,
          canceladoEm: new Date(),
          cStatCancelamento: retorno.cStat,
          xMotivoCancelamento: retorno.xMotivo,
        } as any);

        // Atualiza status fiscal do pedido
        if (nfe.orderId) {
          try {
            await storage.updateOrder(nfe.orderId, { fiscalStatus: 'nota_cancelada' } as any);
          } catch { /* best-effort */ }
        }

        await storage.createLog({
          action: 'NF-E_CANCELADA',
          description: `NF-e #${nfe.id} cancelada na SEFAZ. Protocolo: ${retorno.protocolo} | cStat=${retorno.cStat} | xMotivo=${retorno.xMotivo}`,
          level: 'WARN',
          userId: req.session?.userId,
        });
        logSecurity(`[NFE_CANCELAMENTO_OK] requestId=${requestId} | nfeId=${nfe.id} | protocolo=${retorno.protocolo}`);

        res.json({
          success: true,
          protocolo: retorno.protocolo,
          cStat: retorno.cStat,
          xMotivo: retorno.xMotivo,
        });
      } catch (e: any) {
        logSecurity(`[NFE_CANCELAMENTO_ERRO] requestId=${requestId} | error=${e?.message}`);
        res.status(500).json({ message: e.message });
      }
    });

    // CC-e (Carta de Correção Eletrônica) — FASE 14.3: enterprise hardening
    // T1103 — transmissão REAL na SEFAZ (mock quando NFE_SEFAZ_MODE !== 'production').
    // Rules enforced (in order): motivo length → status → limit → time window
    // Audit persisted after every successful creation.

    // POST /api/nfe/:id/cce — registrar CC-e
    app.post('/api/nfe/:id/cce', requireAuthCore, async (req: any, res) => {
      const requestId = getRequestIdForLog();
      try {
        const { id } = req.params;
        const { correcao } = req.body;
        const nfeId = Number(id);

        // ── Existing validation (FASE 14.2) — do not remove ─────────────────
        if (!correcao || correcao.length < 15) {
          return res.status(400).json({
            success: false,
            error: { message: "Texto da correção inválido (mínimo 15 caracteres)" },
          });
        }

        const nfe = await storage.getNfeEmissao(nfeId);
        if (!nfe) {
          return res.status(404).json({ success: false, error: { message: "NF-e não encontrada" } });
        }

        // ── FASE 14.3 enterprise rules ────────────────────────────────────────
        // Rule 4 — motivo mínimo 10 chars (defensive; route already checks 15)
        validateCceMotivo(correcao);

        // Rule 3 — NF-e deve estar AUTORIZADA
        validateCceStatus(nfe);

        // Rule 1 — limite de 20 CC-e por NF-e
        await validateCceLimit(nfeId);

        // Rule 2 — bloqueio por tempo (30 dias após autorização)
        validateCceTimeWindow(nfe);
        // ── end FASE 14.3 rules ───────────────────────────────────────────────

        const userId: number | null = req.session?.userId || null;
        const empresaId: number | null = currentTenantId() ?? req.session?.companyId ?? null;

        // T1103 — campos obrigatórios para o evento SEFAZ
        if (!nfe.chaveNFe) {
          return res.status(400).json({ success: false, code: 'NFE_CCE_MISSING_CHAVE', error: { message: 'Chave NF-e ausente. Não é possível emitir CC-e.' } });
        }

        // T1103 — transmite CC-e para SEFAZ (mock quando NFE_SEFAZ_MODE !== 'production')
        const emitConfig = await storage.getCompanyConfig();
        const uf = (emitConfig?.state ?? 'SP').trim().toUpperCase();
        const cnpjEmit = (emitConfig?.cnpj ?? '').replace(/\D/g, '');
        const tpAmb: '1' | '2' = nfe.ambienteFiscal === 'producao' ? '1' : '2';

        // Calcula próxima sequência ANTES de transmitir (leitura atômica, sem commit)
        const historico = await storage.getNfeCceHistory(nfeId);
        const proxSequencia = historico.length > 0 ? historico[historico.length - 1].sequencia + 1 : 1;

        logSecurity(`[NFE_CCE] requestId=${requestId} | nfeId=${nfeId} | seq=${proxSequencia} | uf=${uf} | tpAmb=${tpAmb} | user=${userId}`);

        const { enviarCCe } = await import('../services/nfe/nfeSender.ts');
        const retorno = await enviarCCe(nfe.chaveNFe, correcao, proxSequencia, uf, cnpjEmit, tpAmb);

        // cStat de sucesso: 135=vinculado, 136=registrado (sem NF encontrada na SEFAZ — edge case)
        const CCE_SUCCESS = new Set(['135', '136']);
        if (!CCE_SUCCESS.has(retorno.cStat)) {
          logSecurity(`[NFE_CCE_REJEITADA] requestId=${requestId} | nfeId=${nfeId} | cStat=${retorno.cStat} | xMotivo=${retorno.xMotivo}`);
          return res.status(422).json({
            success: false,
            code: 'NFE_CCE_REJECTED',
            cStat: retorno.cStat,
            xMotivo: retorno.xMotivo,
            error: { message: `CC-e rejeitada pela SEFAZ: ${retorno.xMotivo} (cStat=${retorno.cStat})` },
          });
        }

        // T1103 — persiste CC-e com dados completos do evento SEFAZ
        const entrada = await storage.createNfeCce(nfeId, correcao, userId, {
          protocolo: retorno.protocolo || undefined,
          xmlEvento: retorno.xmlEvento || undefined,
          cStat: retorno.cStat,
          xMotivo: retorno.xMotivo,
          transmitidoEm: new Date(),
        });

        // ── FASE 14.3 audit — fire-and-forget, never blocks the response ─────
        void recordCceAudit({
          nfeId,
          sequencia: entrada.sequencia,
          userId,
          empresaId,
          correcao,
          nfeSnapshot: nfe,
          cceSnapshot: entrada,
        });

        logSecurity(`[NFE_CCE_OK] requestId=${requestId} | nfeId=${nfeId} | seq=${entrada.sequencia} | protocolo=${retorno.protocolo}`);

        return res.json({
          success: true,
          message: "Carta de Correção registrada com sucesso",
          cce: entrada,
          protocolo: retorno.protocolo,
          cStat: retorno.cStat,
          xMotivo: retorno.xMotivo,
        });
      } catch (e: any) {
        if (isCceRuleViolation(e)) {
          return res.status(e.status).json({
            success: false,
            error: e.message,
            code: e.code,
          });
        }
        logSecurity(`[NFE_CCE_ERRO] requestId=${requestId} | error=${e?.message}`);
        return res.status(500).json({ success: false, error: { message: e.message } });
      }
    });

    // GET /api/nfe/:id/cce — listar histórico de CC-e
    app.get('/api/nfe/:id/cce', requireAuthCore, async (req: any, res) => {
      try {
        const { id } = req.params;
        const history = await storage.getNfeCceHistory(Number(id));
        return res.json({ success: true, history });
      } catch (e: any) {
        return res.status(500).json({ success: false, error: { message: e.message } });
      }
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

  // ─── Banco Itaú / Integração Bancária — MOVED TO bank.routes.ts ───────────
  // GET    /api/bank/accounts
  // POST   /api/bank/accounts
  // PATCH  /api/bank/accounts/:id
  // DELETE /api/bank/accounts/:id
  // POST   /api/bank/accounts/:id/testar
  // GET    /api/bank/accounts/:id/extrato
  // GET    /api/bank/transactions
  // POST   /api/bank/accounts/:id/boleto
  // POST   /api/bank/reconciliar
  // POST   /api/bank/reconciliar/confirmar
  // POST   /api/bank/remessa/itau
  // POST   /api/bank/retorno/itau
  // GET    /api/bank/retorno/historico

  // ─── AI Developer Routes ─────────────────────────────────────────────────
  {
    const ALLOWED_ROLES = ['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR', 'SUPER_ADMIN'];

    const requireDevAccess = async (req: any, res: any): Promise<boolean> => {
      const user = await storage.getUser(req.session.userId);
      if (!user || !ALLOWED_ROLES.includes(user.role)) {
        res.status(403).json({ message: `Acesso restrito. Seu perfil: ${user?.role || 'desconhecido'}. Necessário: ADMIN, DEVELOPER ou DIRECTOR.` });
        return false;
      }
      return true;
    };

    // GET /api/ai-developer/index — system indexer
    app.get('/api/ai-developer/index', requireAuthCore, async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { buildSystemIndex } = await import('../services/aiDeveloper/systemIndexer.ts');
        const index = await buildSystemIndex();
        res.json(index);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/bugs — bug detection
    app.get('/api/ai-developer/bugs', requireAuthCore, async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { detectBugs } = await import('../services/aiDeveloper/bugDetector.ts');
        const report = await detectBugs();
        res.json(report);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/security — security audit
    app.get('/api/ai-developer/security', requireAuthCore, async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { auditSecurity } = await import('../services/aiDeveloper/codeAnalyzer.ts');
        const report = await auditSecurity();
        res.json(report);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/performance — performance analysis
    app.get('/api/ai-developer/performance', requireAuthCore, async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { analyzePerformance } = await import('../services/aiDeveloper/codeAnalyzer.ts');
        const report = await analyzePerformance();
        res.json(report);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/deploy — generate deploy scripts
    app.get('/api/ai-developer/deploy', requireAuthCore, async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { generateDeployScripts } = await import('../services/aiDeveloper/codeAnalyzer.ts');
        const scripts = generateDeployScripts();
        res.json(scripts);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/database — database analysis
    app.get('/api/ai-developer/database', requireAuthCore, async (req: any, res) => {
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
    app.post('/api/ai-developer/command', requireAuthCore, async (req: any, res) => {
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
    app.get('/api/ai-developer/lab/health', requireAuthCore, async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { getHealthMetrics } = await import('../services/aiDeveloper/labFunctions.ts');
        res.json(getHealthMetrics());
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/lab/test-routes
    app.get('/api/ai-developer/lab/test-routes', requireAuthCore, async (req: any, res) => {
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
    app.get('/api/ai-developer/lab/docs', requireAuthCore, async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { generateDocs } = await import('../services/aiDeveloper/labFunctions.ts');
        res.json(generateDocs());
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/ai-developer/lab/simulate
    app.post('/api/ai-developer/lab/simulate', requireAuthCore, async (req: any, res) => {
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
    app.get('/api/ai-developer/lab/auto-fix', requireAuthCore, async (req: any, res) => {
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
    app.get('/api/ai-developer/lab/ai-logs', requireAuthCore, async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const limit = req.query.limit ? Number(req.query.limit) : 100;
        const logs = await storage.getAiLogs(limit);
        res.json(logs);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/ai-developer/lab/ai-logs — registrar log da IA
    app.post('/api/ai-developer/lab/ai-logs', requireAuthCore, async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { acao, arquivoAfetado, status, detalhes, duracao } = req.body;
        if (!acao) return res.status(400).json({ message: 'acao obrigatório' });
        const log = await storage.createAiLog({ acao, arquivoAfetado, status: status || 'ok', detalhes, duracao, userId: req.session?.userId });
        res.status(201).json(log);
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // POST /api/ai-developer/lab/create-test-company — criar empresa + plano + assinatura de teste
    app.post('/api/ai-developer/lab/create-test-company', requireAuthCore, async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      const results: any[] = [];
      try {
        // 1. Criar empresa teste
        const company = await storage.createCompany({
          companyName: 'Empresa Teste ERP',
          contactName: 'Usuário Teste',
          email: `teste.erp.${Date.now()}@vivafrutaz.com`,
          password: randomBytes(8).toString('hex'),
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
    app.post('/api/ai-developer/lab/create-module', requireAuthCore, async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { name } = req.body;
        if (!name?.trim()) return res.status(400).json({ message: 'Nome do módulo obrigatório' });
        const { createModule } = await import('../services/aiDeveloper/labFunctions.ts');
        res.json(createModule(name.trim()));
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    });

    // GET /api/ai-developer/file — read a specific file
    app.get('/api/ai-developer/file', requireAuthCore, async (req: any, res) => {
      if (!await requireDevAccess(req, res)) return;
      try {
        const { path: filePath } = req.query as { path: string };
        if (!filePath) return res.status(400).json({ message: 'path obrigatório' });
        // T803 — Path traversal fix: resolve the requested path relative to the
        // project root, then verify the result still lives inside the project root.
        // The previous naive .replace(/\.\./g,'') could be bypassed with "....//".
        const nodePath = await import('path');
        const projectRoot = nodePath.resolve(process.cwd());
        const resolved = nodePath.resolve(projectRoot, filePath);
        const relative = nodePath.relative(projectRoot, resolved);
        // Reject if resolved path escapes project root (relative starts with "..")
        // or is an absolute path (path.relative returns absolute when drives differ on Windows).
        if (relative.startsWith('..') || nodePath.isAbsolute(relative)) {
          return res.status(403).json({ message: 'Acesso negado ao caminho solicitado' });
        }
        // Allowlist: only serve files under permitted directories/files.
        const allowed = ['server/', 'client/', 'shared/', 'package.json', 'drizzle.config'];
        if (!allowed.some(a => relative.startsWith(a) || relative === a.replace(/\/$/, ''))) {
          return res.status(403).json({ message: 'Acesso negado ao caminho solicitado' });
        }
        const fs = await import('fs');
        if (!fs.existsSync(resolved)) return res.status(404).json({ message: 'Arquivo não encontrado' });
        const content = fs.readFileSync(resolved, 'utf-8');
        const lines = content.split('\n').length;
        res.json({ path: relative, content: content.slice(0, 50000), lines, truncated: content.length > 50000 });
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
        const devPassword = randomBytes(8).toString('hex');
        await storage.createUser({
          name: "Desenvolvedor VF",
          email: "dev@vivafrutaz.com",
          password: devPassword,
          role: "DEVELOPER",
          active: true,
        });
      }
    } catch (err: any) {
      logSecurity(`[SYSTEM_SEED_FAILED] step=dev_user | error=${err?.message ?? "unknown"}`);
      console.error("[SEED] Error checking/creating dev user:", err);
    }

    // Ensure default MASTER user always exists
    // C1-FIX: Password is NEVER hardcoded. For new environments a cryptographically
    // secure random password is generated ONCE and printed to the server log so the
    // operator can capture it. Existing users in Supabase/production are NEVER touched
    // (the `if (!masterUser)` guard above this block ensures that).
    try {
      const masterUser = await storage.getUserByEmail("master@vivafrutaz.com");
      if (!masterUser) {
        const masterPassword = randomBytes(16).toString("hex");
        await storage.createUser({
          name: "Master VivaFrutaz",
          email: "master@vivafrutaz.com",
          password: masterPassword,
          role: "MASTER",
          active: true,
        });
        console.log("[SEED] Usuário MASTER criado: master@vivafrutaz.com — senha aleatória gerada. Capture-a agora nos logs de inicialização e redefina via painel.");
        console.log(`[SEED_MASTER_SENHA] ${masterPassword}`);
      }
    } catch (err: any) {
      logSecurity(`[SYSTEM_SEED_FAILED] step=master_user | error=${err?.message ?? "unknown"}`);
      console.error("[SEED] Error checking/creating master user:", err);
    }

    try {
      const admin = await storage.getUserByEmail("admin@vivafrutaz.com");
      if (!admin) {
        const adminPassword = randomBytes(8).toString('hex');
        const opsPassword = randomBytes(8).toString('hex');
        const buyPassword = randomBytes(8).toString('hex');
        await storage.createUser({
          name: "Admin User",
          email: "admin@vivafrutaz.com",
          password: adminPassword,
          role: "ADMIN",
          active: true,
        });
        await storage.createUser({
          name: "Operations",
          email: "ops@vivafrutaz.com",
          password: opsPassword,
          role: "OPERATIONS_MANAGER",
          active: true,
        });
        await storage.createUser({
          name: "Purchasing",
          email: "buy@vivafrutaz.com",
          password: buyPassword,
          role: "PURCHASE_MANAGER",
          active: true,
        });
        console.log("[SEED] Usuários admin/ops/buy criados com senhas aleatórias. Redefina via painel.");
      }
    } catch (err: any) {
      logSecurity(`[SYSTEM_SEED_FAILED] step=admin_ops_users | error=${err?.message ?? "unknown"}`);
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
        password: randomBytes(8).toString('hex'),
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
    } catch (err: any) {
      logSecurity(`[SYSTEM_SEED_FAILED] step=price_groups_products | error=${err?.message ?? "unknown"}`);
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
    } catch (seedErr: any) {
      logSecurity(`[SYSTEM_SEED_FAILED] step=marketplace_modules | error=${seedErr?.message ?? "unknown"}`);
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
    } catch (modErr: any) {
      logSecurity(`[SYSTEM_SEED_FAILED] step=sanitary_modules | error=${modErr?.message ?? "unknown"}`);
      console.error('[SEED] Erro ao criar módulos sanitários:', modErr);
    }

    // Seed NUTRICIONISTA test user if not present
    try {
      const nutri = await storage.getUserByEmail('nutri@vivafrutaz.com');
      if (!nutri) {
        const nutriPassword = randomBytes(8).toString('hex');
        await storage.createUser({
          name: 'Nutricionista Teste',
          email: 'nutri@vivafrutaz.com',
          password: nutriPassword,
          role: 'NUTRICIONISTA',
          active: true,
        });
        console.log('[SEED] Usuário NUTRICIONISTA criado: nutri@vivafrutaz.com — senha aleatória definida. Redefina via painel.');
      }
    } catch (nutriErr: any) {
      logSecurity(`[SYSTEM_SEED_FAILED] step=nutricionista_user | error=${nutriErr?.message ?? "unknown"}`);
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
    } catch (sanitaryErr: any) {
      logSecurity(`[SYSTEM_SEED_FAILED] step=sanitary_questions | error=${sanitaryErr?.message ?? "unknown"}`);
      console.error('[SEED] Erro ao criar perguntas sanitárias:', sanitaryErr);
    }

  } catch(e: any) {
    logSecurity(`[SYSTEM_SEED_FAILED] step=seed_root | error=${e?.message ?? "unknown"}`);
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


