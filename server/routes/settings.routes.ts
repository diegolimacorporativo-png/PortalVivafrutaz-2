import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { companySettingsService } from "../services/companySettingsService.ts";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";

export function register(app: Express) {
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

  app.patch('/api/company-config', requireAuthCore, async (req, res) => {
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

  app.post('/api/company-settings/:empresaId', requireAuthCore, async (req, res) => {
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

  app.put('/api/company-settings/:empresaId', requireAuthCore, async (req, res) => {
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

  // --- Test Mode ---
  app.get('/api/settings/test-mode', async (req, res) => {
    try {
      const val = await storage.getSetting('test_mode');
      res.json({ enabled: val === 'true' });
    } catch {
      res.json({ enabled: false });
    }
  });

  app.post('/api/settings/test-mode', requireAuthCore, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
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

  app.post('/api/settings/maintenance', requireAuthCore, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
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
}
