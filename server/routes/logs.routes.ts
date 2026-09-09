import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireSessionOrCompany } from "../core/http/requireSessionOrCompany";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import {
  canAccessAuditLogs,
  canManageAuditLogs,
  parseRequestedCompanyId,
  resolveAuditScope,
  sanitizeManualClientLog,
} from "../modules/audit/audit-log.policy";

export async function register(app: Express): Promise<void> {
  async function getActor(req: any) {
    if (!req.session?.userId) return null;
    return storage.getUser(req.session.userId);
  }

  async function getAuditScope(req: any) {
    const actor = await getActor(req);
    if (!actor || !canAccessAuditLogs(actor)) return { actor, scope: null };
    const requestedCompanyId = parseRequestedCompanyId(req.query ?? {});
    const hasTenantFilter = ["companyId", "empresaId", "tenantId"]
      .some((key) => req.query?.[key] != null && req.query[key] !== "");
    if (hasTenantFilter && requestedCompanyId == null) {
      return { actor, scope: null, invalidTenant: true };
    }
    return { actor, scope: resolveAuditScope(actor, requestedCompanyId) };
  }

  // GET /api/admin/logs — lista logs (paginado por ?limit)
  // Tenant-bound users are pinned to their own company. Only unpinned
  // MASTER/DIRECTOR retain the pre-existing global view.
  app.get('/api/admin/logs', requireAuth, requireRole(['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR']), async (req, res) => {
    try {
      const { scope, invalidTenant } = await getAuditScope(req);
      if (invalidTenant) return res.status(400).json({ message: "Tenant inválido" });
      if (!scope) return res.status(403).json({ message: "Sem tenant para consulta de logs" });
      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const logs = await storage.getLogsScoped(limit, scope.kind === "tenant" ? scope.companyId : scope.companyId);
      res.json(logs);
    } catch {
      res.status(500).json({ message: "Erro ao buscar logs" });
    }
  });

  // POST /api/logs — registrar log de cliente (B1-FIX: require valid session)
  app.post('/api/logs', requireSessionOrCompany, async (req, res) => {
    try {
      const safe = sanitizeManualClientLog(req.body ?? {});
      if (!safe) return res.status(400).json({ message: 'Evento de frontend inválido.' });

      const actor = await getActor(req);
      const companyId = actor?.empresaId ?? req.session?.companyId ?? undefined;
      const userId = actor?.id ?? req.session?.userId ?? undefined;
      await storage.createLog({
        ...safe,
        userId,
        companyId,
        userEmail: actor?.email ?? undefined,
        userRole: actor?.role ?? undefined,
      });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: 'Erro ao registrar log' }); }
  });

  // ─── LOGS: limpar todos ───────────────────────────────────────
  app.delete('/api/logs', requireSessionOrCompany, async (req, res) => {
    const { actor, scope } = await getAuditScope(req);
    if (!actor || !canManageAuditLogs(actor) || !scope) return res.status(403).json({ message: 'Sem permissão' });
    try {
      const companyId = scope.kind === "tenant" ? scope.companyId : scope.companyId;
      const allLogs = await storage.getLogsScoped(10000, companyId);
      const count = allLogs.length;
      await storage.clearLogsScoped(companyId);
      await storage.createLog({ action: 'CLEAN_LOGS', description: `Histórico de logs limpo (${count} registros removidos)`, userId: actor.id, userEmail: actor.email, userRole: actor.role, level: 'WARN', companyId });
      res.json({ ok: true, removed: count });
    } catch (e) { res.status(500).json({ message: 'Erro ao limpar logs' }); }
  });

  // ─── LOGS: excluir selecionados ───────────────────────────────
  app.delete('/api/logs/selected', requireSessionOrCompany, async (req, res) => {
    const { actor, scope } = await getAuditScope(req);
    if (!actor || !canManageAuditLogs(actor) || !scope) return res.status(403).json({ message: 'Sem permissão' });
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ message: 'IDs inválidos.' });
      const companyId = scope.kind === "tenant" ? scope.companyId : scope.companyId;
      const normalizedIds = ids.map(Number).filter((id: number) => Number.isInteger(id) && id > 0);
      if (!normalizedIds.length) return res.status(400).json({ message: 'IDs inválidos.' });
      const removed = await storage.deleteLogsByIdsScoped(normalizedIds, companyId);
      await storage.createLog({ action: 'CLEAN_LOGS', description: `${removed} log(s) selecionados removidos`, userId: actor.id, userEmail: actor.email, userRole: actor.role, level: 'WARN', companyId });
      res.json({ ok: true, removed });
    } catch (e) { res.status(500).json({ message: 'Erro ao excluir logs' }); }
  });

  // ─── LOGS: limpar por período ─────────────────────────────────
  app.delete('/api/logs/by-date', requireSessionOrCompany, async (req, res) => {
    const { actor, scope } = await getAuditScope(req);
    if (!actor || !canManageAuditLogs(actor) || !scope) return res.status(403).json({ message: 'Sem permissão' });
    try {
      const { startDate, endDate } = req.body;
      if (!startDate || !endDate) return res.status(400).json({ message: 'Datas inválidas.' });
      const start = new Date(startDate + 'T00:00:00');
      const end = new Date(endDate + 'T23:59:59');
      if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start > end) {
        return res.status(400).json({ message: 'Datas inválidas.' });
      }
      const companyId = scope.kind === "tenant" ? scope.companyId : scope.companyId;
      const removed = await storage.deleteLogsByDateRangeScoped(start, end, companyId);
      await storage.createLog({ action: 'CLEAN_LOGS', description: `${removed} log(s) removidos no período ${startDate} a ${endDate}`, userId: actor.id, userEmail: actor.email, userRole: actor.role, level: 'WARN', companyId });
      res.json({ ok: true, removed });
    } catch (e) { res.status(500).json({ message: 'Erro ao limpar logs por data' }); }
  });

  // ─── LOGS: exportar CSV ───────────────────────────────────────
  app.get('/api/logs/export', requireSessionOrCompany, async (req, res) => {
    const { scope } = await getAuditScope(req);
    if (!scope) return res.status(403).json({ message: 'Sem permissão' });
    try {
      const companyId = scope.kind === "tenant" ? scope.companyId : scope.companyId;
      const logs = await storage.getLogsScoped(10000, companyId);
      const headers = ['ID', 'Nível', 'Ação', 'Descrição', 'Usuário', 'E-mail', 'Papel', 'IP', 'Data/Hora'];
      const rows = logs.map(l => [l.id, l.level || 'INFO', l.action, `"${(l.description || '').replace(/"/g, "'")}"`, l.userId || '', l.userEmail || '', l.userRole || '', l.ip || '', new Date(l.createdAt).toLocaleString('pt-BR')]);
      const csv = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
      res.setHeader('Content-Type', 'text/csv;charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="logs_${new Date().toISOString().slice(0,10)}.csv"`);
      res.send(csv);
    } catch (e) { res.status(500).json({ message: 'Erro ao exportar logs' }); }
  });
}
