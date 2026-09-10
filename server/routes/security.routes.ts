import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import { tenantContext } from "../middleware/tenant";
import { currentTenantId } from "../core/tenant/context";

export function register(app: Express) {
  app.post('/api/admin/companies/:id/unlock', requireAuthCore, tenantContext, async (req, res) => {
    const actor = await storage.getUser(req.session.userId!);
    if (!actor || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(actor.role)) return res.status(403).json({ message: 'Sem permissão para desbloquear contas.' });
    try {
      const id = Number(req.params.id);
      const tenantId = currentTenantId();
      if (tenantId != null && tenantId !== id) {
        return res.status(403).json({ message: 'Sem permissão para desbloquear contas.' });
      }
      const target = await storage.getCompany(id);
      if (!target) return res.status(404).json({ message: 'Empresa não encontrada.' });
      await storage.updateCompany(id, { isLocked: false, loginAttempts: 0 } as any);
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
      await storage.createLog({ action: 'ACCOUNT_UNLOCKED', description: `Empresa desbloqueada por ${actor.name} (${actor.role}): ${target.companyName} (${target.email})`, userId: actor.id, companyId: id, userEmail: target.email, userRole: actor.role, level: 'INFO', ip });
      return res.json({ message: `Conta da empresa ${target.companyName} desbloqueada com sucesso.` });
    } catch (err) {
      res.status(500).json({ message: 'Erro ao desbloquear empresa.' });
    }
  });

  app.get('/api/security-logs', requireAuthCore, async (req, res) => {
    const actor = await storage.getUser(req.session.userId!);
    if (!actor || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(actor.role)) return res.status(403).json({ message: 'Sem permissão.' });
    try {
      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const logs = await storage.getSecurityLogs(limit);
      res.json(logs);
    } catch {
      res.status(500).json({ message: 'Erro ao buscar logs de segurança.' });
    }
  });

  app.get('/api/security/locked-accounts', requireAuthCore, tenantContext, async (req, res) => {
    const actor = await storage.getUser(req.session.userId!);
    if (!actor || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(actor.role)) return res.status(403).json({ message: 'Sem permissão.' });
    try {
      const allUsers = await storage.getUsers();
      const allCompanies = await storage.getCompanies();
      const tenantId = currentTenantId();
      const lockedUsers = allUsers
        .filter(u => u.isLocked && (tenantId == null || u.empresaId === tenantId))
        .map(u => ({ id: u.id, type: 'user', name: u.name, email: u.email, role: u.role, loginAttempts: u.loginAttempts, lastLoginAttempt: u.lastLoginAttempt }));
      const lockedCompanies = allCompanies
        .filter(c => (c as any).isLocked && (tenantId == null || c.id === tenantId))
        .map(c => ({ id: c.id, type: 'company', name: c.companyName, email: c.email, role: 'CLIENT', loginAttempts: (c as any).loginAttempts, lastLoginAttempt: (c as any).lastLoginAttempt }));
      res.json([...lockedUsers, ...lockedCompanies]);
    } catch {
      res.status(500).json({ message: 'Erro ao buscar contas bloqueadas.' });
    }
  });
}
