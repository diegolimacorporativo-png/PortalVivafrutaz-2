import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireSessionOrCompany } from "../core/http/requireSessionOrCompany";

export async function register(app: Express): Promise<void> {
  // GET /api/admin/logs — lista logs (paginado por ?limit)
  app.get('/api/admin/logs', async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const logs = await storage.getLogs(limit);
      res.json(logs);
    } catch {
      res.status(500).json({ message: "Erro ao buscar logs" });
    }
  });

  // POST /api/logs — registrar log de cliente
  app.post('/api/logs', async (req, res) => {
    try {
      const { action, description, level } = req.body;
      if (!action || !description) return res.status(400).json({ message: 'Campos obrigatórios.' });
      const userId = req.session?.userId;
      const companyId = req.session?.companyId;
      const safeLevel = ['INFO', 'WARN', 'ERROR'].includes(level) ? level : 'INFO';
      await storage.createLog({ action: action.slice(0, 100), description: description.slice(0, 1000), userId, companyId, level: safeLevel });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: 'Erro ao registrar log' }); }
  });

  // ─── LOGS: limpar todos ───────────────────────────────────────
  app.delete('/api/logs', requireSessionOrCompany, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
    try {
      const allLogs = await storage.getLogs(10000);
      const count = allLogs.length;
      await storage.clearLogs();
      await storage.createLog({ action: 'CLEAN_LOGS', description: `Histórico de logs limpo (${count} registros removidos)`, userId: user.id, userEmail: user.email, userRole: user.role, level: 'WARN' });
      res.json({ ok: true, removed: count });
    } catch (e) { res.status(500).json({ message: 'Erro ao limpar logs' }); }
  });

  // ─── LOGS: excluir selecionados ───────────────────────────────
  app.delete('/api/logs/selected', requireSessionOrCompany, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ message: 'IDs inválidos.' });
      const removed = await storage.deleteLogsByIds(ids.map(Number));
      await storage.createLog({ action: 'CLEAN_LOGS', description: `${removed} log(s) selecionados removidos`, userId: user.id, userEmail: user.email, userRole: user.role, level: 'WARN' });
      res.json({ ok: true, removed });
    } catch (e) { res.status(500).json({ message: 'Erro ao excluir logs' }); }
  });

  // ─── LOGS: limpar por período ─────────────────────────────────
  app.delete('/api/logs/by-date', requireSessionOrCompany, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
    try {
      const { startDate, endDate } = req.body;
      if (!startDate || !endDate) return res.status(400).json({ message: 'Datas inválidas.' });
      const start = new Date(startDate + 'T00:00:00');
      const end = new Date(endDate + 'T23:59:59');
      const removed = await storage.deleteLogsByDateRange(start, end);
      await storage.createLog({ action: 'CLEAN_LOGS', description: `${removed} log(s) removidos no período ${startDate} a ${endDate}`, userId: user.id, userEmail: user.email, userRole: user.role, level: 'WARN' });
      res.json({ ok: true, removed });
    } catch (e) { res.status(500).json({ message: 'Erro ao limpar logs por data' }); }
  });

  // ─── LOGS: exportar CSV ───────────────────────────────────────
  app.get('/api/logs/export', requireSessionOrCompany, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
    try {
      const logs = await storage.getLogs(10000);
      const headers = ['ID', 'Nível', 'Ação', 'Descrição', 'Usuário', 'E-mail', 'Papel', 'IP', 'Data/Hora'];
      const rows = logs.map(l => [l.id, l.level || 'INFO', l.action, `"${(l.description || '').replace(/"/g, "'")}"`, l.userId || '', l.userEmail || '', l.userRole || '', l.ip || '', new Date(l.createdAt).toLocaleString('pt-BR')]);
      const csv = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
      res.setHeader('Content-Type', 'text/csv;charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="logs_${new Date().toISOString().slice(0,10)}.csv"`);
      res.send(csv);
    } catch (e) { res.status(500).json({ message: 'Erro ao exportar logs' }); }
  });
}
