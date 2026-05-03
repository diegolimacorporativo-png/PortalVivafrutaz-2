import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";

export async function register(app: Express): Promise<void> {
  // Simple liveness probe
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Full health check — DB, auth, session, maintenance, test-mode
  app.get('/api/health', requireAuthCore, requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]), async (req, res) => {
    const start = Date.now();
    const report: any = { timestamp: new Date().toISOString(), checks: {} };
    // DB check
    try {
      await storage.getLogs(1);
      report.checks.database = { status: 'OK', message: 'Banco de dados conectado' };
    } catch (e: any) {
      report.checks.database = { status: 'ERROR', message: e?.message };
    }
    // Auth check
    try {
      const users = await storage.getUsers();
      report.checks.auth = { status: 'OK', message: `${users.length} usuários cadastrados` };
    } catch (e: any) {
      report.checks.auth = { status: 'ERROR', message: e?.message };
    }
    // Orders check
    try {
      const recent = await storage.getLogs(5);
      report.checks.logs = { status: 'OK', message: `${recent.length} logs recentes` };
    } catch (e: any) {
      report.checks.logs = { status: 'ERROR', message: e?.message };
    }
    // Server
    report.checks.server = { status: 'OK', message: `Servidor respondendo — ${Date.now() - start}ms` };
    // Session
    report.checks.session = {
      status: req.session?.userId || req.session?.companyId ? 'OK' : 'WARN',
      message: req.session?.userId ? `Usuário #${req.session.userId} autenticado` : req.session?.companyId ? `Empresa #${req.session.companyId}` : 'Sem sessão ativa nesta requisição'
    };
    // Maintenance mode
    try {
      const maintenance = await storage.getSetting('maintenance_mode');
      report.checks.maintenance = { status: maintenance === 'true' ? 'WARN' : 'OK', message: maintenance === 'true' ? 'MANUTENÇÃO ATIVA' : 'Sistema operacional' };
    } catch (e) {
      report.checks.maintenance = { status: 'WARN', message: 'Não verificado' };
    }
    // Test mode
    try {
      const testMode = await storage.getSetting('test_mode');
      report.checks.testMode = { status: testMode === 'true' ? 'WARN' : 'OK', message: testMode === 'true' ? 'MODO TESTE ATIVO' : 'Modo produção' };
    } catch (e) {
      report.checks.testMode = { status: 'WARN', message: 'Não verificado' };
    }
    report.overall = Object.values(report.checks).every((c: any) => c.status !== 'ERROR') ? 'HEALTHY' : 'DEGRADED';
    report.responseMs = Date.now() - start;
    res.json(report);
  });
}
