import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { companySettingsService } from "../services/companySettingsService.ts";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { runWithTenant } from "../core/tenant/context";
import { auditLog } from "../utils/auditLogger";
import {
  EMPRESA_CONFIG_ROLES,
  resolveEmpresaConfigAccess,
  sanitizeEmpresaConfigBody,
} from "./empresa-config.policy";

const COMPANY_CONFIG_FULL_ACCESS_ROLES = new Set(["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"]);

// Non-privileged authenticated screens only need display/DANFE fields.
// Credentials and fiscal certificate material are intentionally excluded.
const COMPANY_CONFIG_SAFE_FIELDS = [
  "companyName",
  "fantasyName",
  "address",
  "addressNumber",
  "neighborhood",
  "city",
  "state",
  "cep",
  "phone",
  "email",
  "cnpj",
  "stateRegistration",
  "supportPhone",
  "supportEmail",
  "supportMessage",
  "defaultCfop",
  "defaultNatureza",
  "logoBase64",
  "logoType",
] as const;

function toSafeCompanyConfig(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    COMPANY_CONFIG_SAFE_FIELDS
      .filter((field) => config[field] !== undefined)
      .map((field) => [field, config[field]]),
  );
}

export function register(app: Express) {
  // ─── PUBLIC ROUTES FIRST (must be registered before the generic :key wildcard) ───

  // Maintenance mode — checked on the login page before auth, must be public
  app.get('/api/settings/maintenance', async (_req, res) => {
    try {
      const val = await storage.getSetting('maintenance_mode');
      res.json({ enabled: val === 'true' });
    } catch {
      res.json({ enabled: false });
    }
  });

  // Test mode status — also public read
  app.get('/api/settings/test-mode', async (_req, res) => {
    try {
      const val = await storage.getSetting('test_mode');
      res.json({ enabled: val === 'true' });
    } catch {
      res.json({ enabled: false });
    }
  });

  // ─── PROTECTED GENERIC CATCH-ALL (registered after specific public routes) ───
  // System Settings
  app.get('/api/settings/:key', requireAuthCore, requireRole(["MASTER"], { strict: true }), async (req, res) => {
    const key = String(req.params.key);
    const value = await storage.getSetting(key);
    if (key === 'maintenance' || key === 'test-mode') {
      const dbKey = key === 'maintenance' ? 'maintenance_mode' : 'test_mode';
      const modeVal = await storage.getSetting(dbKey);
      return res.json({ enabled: modeVal === 'true' });
    }
    res.json({ key, value });
  });

  app.put('/api/settings/:key', requireAuthCore, requireRole(["MASTER"], { strict: true }), async (req: any, res) => {
    const { value } = req.body;
    if (typeof value !== 'string') return res.status(400).json({ message: 'value required' });
    const key = String(req.params.key);
    auditLog("UPDATE_SYSTEM_SETTING", {
      userId: req.session?.userId,
      role: req.session?.userRole,
      entity: "system_setting",
      entityId: key,
      details: { value },
    });
    await storage.setSetting(key, value);
    res.json({ key, value });
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
  // The logo endpoint above is the only public company-config surface.
  // This endpoint is authenticated because the full row contains credentials
  // and A1 certificate material used by the fiscal runtime.
  app.get('/api/company-config', requireAuthCore, async (req, res) => {
    try {
      const config = await storage.getCompanyConfig();
      if (!config) return res.json({ companyName: 'VivaFrutaz' });

      const session = (req as any).session;
      let role = session?.userRole as string | undefined;
      if (!role && session?.userId) {
        const user = await storage.getUser(session.userId);
        role = user?.role;
      }

      if (!role || !COMPANY_CONFIG_FULL_ACCESS_ROLES.has(role)) {
        return res.json(toSafeCompanyConfig(config as unknown as Record<string, unknown>));
      }

      res.json(config);
    } catch (e) { res.status(500).json({ message: 'Error fetching config' }); }
  });

  app.patch('/api/company-config', requireAuthCore, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
      return res.status(403).json({ message: 'Sem permissão' });
    }
    // HOMOLOGATION GUARD — bloqueia escrita de ambienteFiscal=producao via API.
    if (req.body?.ambienteFiscal === 'producao' || req.body?.ambiente_fiscal === 'producao') {
      console.error('[FISCAL_PRODUCTION_BLOCKED]', {
        reason: 'Tentativa de escrita ambienteFiscal=producao via PATCH /api/company-config bloqueada',
        userId: user?.id,
        role: user?.role,
        source: 'settings.routes/company-config',
        ts: new Date().toISOString(),
      });
      return res.status(403).json({
        message: 'Ambiente fiscal de produção não pode ser ativado. Sistema permanece em HOMOLOGAÇÃO.',
        code: 'FISCAL_PRODUCTION_BLOCKED',
      });
    }
    try {
      auditLog("UPDATE_COMPANY_CONFIG", {
        userId: user.id,
        role: user.role,
        entity: "company_config",
        details: req.body,
      });
      const updated = await storage.updateCompanyConfig(req.body);
      await storage.createLog({ action: 'COMPANY_CONFIG_UPDATED', description: `Configuração de suporte atualizada por ${user.name}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Company Settings (White-label)
  app.get('/api/company-settings/:empresaId', requireAuthCore, async (req: any, res, next) => {
    const actor = await storage.getUser(req.session.userId);
    const empresaId = Number(req.params.empresaId);
    const access = resolveEmpresaConfigAccess(actor ?? {}, empresaId);
    if (!access.allowed) {
      return res.status(access.status).json({ message: access.message });
    }
    if (!actor || !EMPRESA_CONFIG_ROLES.includes(actor.role as any)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    try {
      const settings = await runWithTenant(
        {
          principal: {
            kind: "admin",
            empresaId: access.tenantId,
            userId: actor.id,
            role: actor.role,
          },
          empresaId: access.tenantId,
        },
        () => companySettingsService.getSettings(empresaId),
      );
      res.json(settings);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/company-settings/:empresaId', requireAuthCore, async (req: any, res, next) => {
    const actor = await storage.getUser(req.session.userId);
    const empresaId = Number(req.params.empresaId);
    const access = resolveEmpresaConfigAccess(actor ?? {}, empresaId);
    if (!access.allowed) {
      return res.status(access.status).json({ message: access.message });
    }
    if (!actor || !EMPRESA_CONFIG_ROLES.includes(actor.role as any)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    try {
      const updates = sanitizeEmpresaConfigBody(req.body) as any;
      auditLog("UPDATE_COMPANY_SETTINGS", {
        userId: actor.id,
        role: actor.role,
        entity: "company_settings",
        entityId: empresaId,
        details: updates,
      });
      const settings = await runWithTenant(
        {
          principal: {
            kind: "admin",
            empresaId: access.tenantId,
            userId: actor.id,
            role: actor.role,
          },
          empresaId: access.tenantId,
        },
        () => companySettingsService.updateSettings(empresaId, updates),
      );
      await storage.createLog({ action: 'COMPANY_SETTINGS_UPDATED', description: `Configurações white-label atualizadas para empresa ${empresaId} por ${actor.name}`, userId: actor.id, userEmail: actor.email, userRole: actor.role });
      res.json(settings);
    } catch (error) {
      return next(error);
    }
  });

  app.put('/api/company-settings/:empresaId', requireAuthCore, async (req: any, res, next) => {
    const actor = await storage.getUser(req.session.userId);
    const empresaId = Number(req.params.empresaId);
    const access = resolveEmpresaConfigAccess(actor ?? {}, empresaId);
    if (!access.allowed) {
      return res.status(access.status).json({ message: access.message });
    }
    if (!actor || !EMPRESA_CONFIG_ROLES.includes(actor.role as any)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    try {
      const updates = sanitizeEmpresaConfigBody(req.body) as any;
      auditLog("UPDATE_COMPANY_SETTINGS", {
        userId: actor.id,
        role: actor.role,
        entity: "company_settings",
        entityId: empresaId,
        details: updates,
      });
      const settings = await runWithTenant(
        {
          principal: {
            kind: "admin",
            empresaId: access.tenantId,
            userId: actor.id,
            role: actor.role,
          },
          empresaId: access.tenantId,
        },
        () => companySettingsService.updateSettings(empresaId, updates),
      );
      await storage.createLog({ action: 'COMPANY_SETTINGS_UPDATED', description: `Configurações white-label atualizadas para empresa ${empresaId} por ${actor.name}`, userId: actor.id, userEmail: actor.email, userRole: actor.role });
      res.json(settings);
    } catch (error) {
      return next(error);
    }
  });

  // --- Test Mode (write — protected) ---
  app.post('/api/settings/test-mode', requireAuthCore, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }
      const { enabled } = req.body;
      auditLog("TOGGLE_TEST_MODE", {
        userId: user.id,
        role: user.role,
        entity: "system_setting",
        entityId: "test_mode",
        details: { enabled },
      });
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

  // V-03 fix: test-orders is an admin endpoint — require auth + role
  app.get('/api/admin/test-orders', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER']), async (req, res) => {
    try {
      const orders = await storage.getTestOrders();
      res.json(orders);
    } catch {
      res.status(500).json({ message: 'Erro interno' });
    }
  });

  // --- Maintenance Mode (write — protected) ---
  app.post('/api/settings/maintenance', requireAuthCore, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }
      const { enabled } = req.body;
      auditLog("TOGGLE_MAINTENANCE_MODE", {
        userId: user.id,
        role: user.role,
        entity: "system_setting",
        entityId: "maintenance_mode",
        details: { enabled },
      });
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
}
