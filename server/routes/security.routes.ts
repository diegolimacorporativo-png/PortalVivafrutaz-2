import type { Express } from "express";
import { storage } from "../services/storage.ts";

export function register(app: Express) {
  // ─── Security: Unlock company account ─────────────────────────
  app.post('/api/admin/companies/:id/unlock', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(actor.role)) return res.status(403).json({ message: 'Sem permissão para desbloquear contas.' });
    try {
      const id = Number(req.params.id);
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

  // ─── Security Logs ────────────────────────────────────────────
  app.get('/api/security-logs', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(actor.role)) return res.status(403).json({ message: 'Sem permissão.' });
    try {
      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const logs = await storage.getSecurityLogs(limit);
      res.json(logs);
    } catch {
      res.status(500).json({ message: 'Erro ao buscar logs de segurança.' });
    }
  });

  // ─── Locked accounts summary ──────────────────────────────────
  app.get('/api/security/locked-accounts', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(actor.role)) return res.status(403).json({ message: 'Sem permissão.' });
    try {
      const allUsers = await storage.getUsers();
      const allCompanies = await storage.getCompanies();
      const lockedUsers = allUsers.filter(u => u.isLocked).map(u => ({ id: u.id, type: 'user', name: u.name, email: u.email, role: u.role, loginAttempts: u.loginAttempts, lastLoginAttempt: u.lastLoginAttempt }));
      const lockedCompanies = allCompanies.filter(c => (c as any).isLocked).map(c => ({ id: c.id, type: 'company', name: c.companyName, email: c.email, role: 'CLIENT', loginAttempts: (c as any).loginAttempts, lastLoginAttempt: (c as any).lastLoginAttempt }));
      res.json([...lockedUsers, ...lockedCompanies]);
    } catch {
      res.status(500).json({ message: 'Erro ao buscar contas bloqueadas.' });
    }
  });
}
