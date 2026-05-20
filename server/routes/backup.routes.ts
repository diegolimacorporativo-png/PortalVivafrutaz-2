import type { Express } from "express";
import fs from "fs";
import { storage } from "../services/storage.ts";
import {
  runBackup,
  runBackupSQL,
  listBackups,
  getBackupPath,
  deleteBackup,
  cleanOldBackups,
  getBackupStats,
  validateBackup,
  restoreDryRun,
  restoreSandbox,
  restorePlanner,
  acquireRestoreLock,
  releaseRestoreLock,
  getRestoreLockState,
} from "../backup";
import {
  listBackupHistory,
  backupMonitorStatus,
  storageAvailable,
} from "../backup-storage.service";
import { requireSessionOrCompany } from "../core/http/requireSessionOrCompany";
import { requireRole } from "../core/http/requireAuth";
import { logSecurity } from "../core/security/securityLogger";
import { startJobRun, finishJobRun } from "../core/jobs/job-registry";
import { incJobFailures } from "../core/observability/metrics";

const BACKUP_ROLES  = ['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'];
const MASTER_ONLY   = ['MASTER'];

async function auditLog(req: any, action: string, description: string, level: string = 'INFO') {
  try {
    const user = await storage.getUser(req.session?.userId);
    await storage.createLog({ action, description, userId: user?.id, userEmail: user?.email, userRole: user?.role, level });
  } catch { /* non-blocking */ }
}

export async function register(app: Express): Promise<void> {

  // ── Backup History (persistente, banco de dados) ──────────────
  app.get('/api/admin/backups/history', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (_req, res) => {
    try {
      const rows = await listBackupHistory(100);
      res.json({ success: true, data: rows, storageConfigured: storageAvailable() });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message ?? "Erro ao listar histórico" });
    }
  });

  // ── Backup Monitor ────────────────────────────────────────────
  app.get('/api/admin/backups/monitor', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (_req, res) => {
    try {
      const status = await backupMonitorStatus();
      res.json({ success: true, data: status });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message ?? "Erro no monitor" });
    }
  });

  // ── Restore Check (dry-run por ID do histórico) ───────────────
  // Valida integridade e estrutura sem tocar no banco.
  // NÃO faz restore real. NÃO sobrescreve dados.
  app.post('/api/admin/backups/:id/restore-check', requireSessionOrCompany, requireRole(MASTER_ONLY), async (req: any, res) => {
    const { id } = req.params;
    const corrId = `restore-check-${Date.now()}`;

    const rows = await listBackupHistory(200);
    const record = rows.find(r => String(r.id) === String(id));
    if (!record) {
      return res.status(404).json({ success: false, message: `Backup ID ${id} não encontrado no histórico.` });
    }

    if (!acquireRestoreLock(corrId)) {
      const lockState = getRestoreLockState();
      return res.status(409).json({
        success: false,
        message: `Restore em andamento (correlationId: ${lockState.holder}). Aguarde antes de iniciar outro.`,
      });
    }

    if (!startJobRun("restore-dry-run")) {
      releaseRestoreLock(corrId);
      return res.status(409).json({ success: false, message: "Job restore-dry-run já em execução." });
    }

    try {
      logSecurity(`[RESTORE_CHECK] started | id=${id} | file=${record.filename} | correlationId=${corrId}`);

      // Validação de integridade + estrutura (sandbox)
      const sandbox = restoreSandbox(record.filename);
      // Análise de conflitos com banco atual (dry-run)
      const dryRun = await restoreDryRun(record.filename);

      await auditLog(req, 'RESTORE_CHECK', `Restore-check id=${id} arquivo=${record.filename} — risco=${dryRun.riskLevel}`, 'INFO');
      finishJobRun("restore-dry-run", true);

      res.json({
        success: true,
        data: {
          record,
          sandbox,
          dryRun,
          verdict: dryRun.riskLevel === "LOW" && sandbox.safeToSimulate
            ? "SAFE_TO_RESTORE"
            : dryRun.riskLevel === "CRITICAL"
            ? "BLOCKED"
            : "REVIEW_REQUIRED",
        },
      });
    } catch (err: any) {
      logSecurity(`[RESTORE_CHECK] error | id=${id} | correlationId=${corrId} | err=${err?.message}`);
      finishJobRun("restore-dry-run", false, err?.message);
      incJobFailures();
      res.status(500).json({ success: false, message: err?.message ?? "Erro no restore-check" });
    } finally {
      releaseRestoreLock(corrId);
    }
  });

  // ── List & Stats ─────────────────────────────────────────────
  app.get('/api/admin/backups', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (_req, res) => {
    try {
      res.json(listBackups());
    } catch {
      res.status(500).json({ message: "Erro ao listar backups" });
    }
  });

  app.get('/api/admin/backups/stats', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (_req, res) => {
    try {
      res.json({ success: true, data: getBackupStats() });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message ?? "Erro ao obter stats de backup" });
    }
  });

  // ── T504: Restore Lock Status ─────────────────────────────────
  // Must be registered BEFORE /:filename routes
  app.get('/api/admin/backups/restore-lock', requireSessionOrCompany, requireRole(MASTER_ONLY), (_req, res) => {
    res.json({ success: true, data: getRestoreLockState() });
  });

  // ── Create Backups ────────────────────────────────────────────
  app.post('/api/admin/backups', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (req: any, res) => {
    try {
      const filename = await runBackup();
      await auditLog(req, 'BACKUP_CREATED', `Backup JSON criado manualmente: ${filename}`);
      res.status(201).json({ filename, message: "Backup JSON criado com sucesso." });
    } catch (err: any) {
      res.status(500).json({ message: "Erro ao criar backup: " + err?.message });
    }
  });

  app.post('/api/admin/backups/sql', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (req: any, res) => {
    try {
      const filename = await runBackupSQL();
      await auditLog(req, 'BACKUP_CREATED', `Backup SQL criado manualmente: ${filename}`);
      res.status(201).json({ filename, message: "Backup SQL criado com sucesso." });
    } catch (err: any) {
      res.status(500).json({ message: "Erro ao criar backup SQL: " + err?.message });
    }
  });

  // ── T502: Restore Sandbox (MASTER only, read-only, no DB) ─────
  app.post('/api/admin/backups/:filename/sandbox', requireSessionOrCompany, requireRole(MASTER_ONLY), async (req: any, res) => {
    const { filename } = req.params;
    const corrId = `sandbox-${Date.now()}`;

    if (!acquireRestoreLock(corrId)) {
      const lockState = getRestoreLockState();
      return res.status(409).json({
        success: false,
        message: `Restore em andamento (correlationId: ${lockState.holder}). Aguarde a conclusão antes de iniciar outro.`,
      });
    }

    if (!startJobRun("restore-sandbox")) {
      releaseRestoreLock(corrId);
      return res.status(409).json({ success: false, message: "Job restore-sandbox já em execução." });
    }

    try {
      logSecurity(`[RESTORE_SANDBOX] started | file=${filename} | correlationId=${corrId}`);
      const result = restoreSandbox(filename);
      await auditLog(req, 'RESTORE_SANDBOX', `Sandbox de restore: ${filename} — ${result.summary}`, result.safeToSimulate ? 'INFO' : 'WARN');
      finishJobRun("restore-sandbox", true);
      res.json({ success: true, data: result });
    } catch (err: any) {
      logSecurity(`[RESTORE_SANDBOX] error | file=${filename} | correlationId=${corrId} | err=${err?.message}`);
      finishJobRun("restore-sandbox", false, err?.message);
      incJobFailures();
      res.status(500).json({ success: false, message: err?.message ?? "Erro no sandbox de restore" });
    } finally {
      releaseRestoreLock(corrId);
    }
  });

  // ── T501: Restore Dry-Run (MASTER only, reads live DB — READ ONLY) ──
  app.post('/api/admin/backups/:filename/dry-run', requireSessionOrCompany, requireRole(MASTER_ONLY), async (req: any, res) => {
    const { filename } = req.params;
    const corrId = `dryrun-${Date.now()}`;

    if (!acquireRestoreLock(corrId)) {
      const lockState = getRestoreLockState();
      return res.status(409).json({
        success: false,
        message: `Restore em andamento (correlationId: ${lockState.holder}). Aguarde antes de iniciar outro.`,
      });
    }

    if (!startJobRun("restore-dry-run")) {
      releaseRestoreLock(corrId);
      return res.status(409).json({ success: false, message: "Job restore-dry-run já em execução." });
    }

    try {
      logSecurity(`[RESTORE_DRY_RUN] started | file=${filename} | correlationId=${corrId}`);
      const result = await restoreDryRun(filename);
      const level = result.riskLevel === "LOW" ? "INFO" : result.riskLevel === "CRITICAL" ? "ERROR" : "WARN";
      await auditLog(req, 'RESTORE_DRY_RUN', `Dry-run de restore: ${filename} — risco=${result.riskLevel} | ${result.summary}`, level);
      finishJobRun("restore-dry-run", true);
      res.json({ success: true, data: result });
    } catch (err: any) {
      logSecurity(`[RESTORE_DRY_RUN] error | file=${filename} | correlationId=${corrId} | err=${err?.message}`);
      finishJobRun("restore-dry-run", false, err?.message);
      incJobFailures();
      res.status(500).json({ success: false, message: err?.message ?? "Erro no dry-run de restore" });
    } finally {
      releaseRestoreLock(corrId);
    }
  });

  // ── T503: Restore Planner (MASTER only, reads live DB — READ ONLY) ──
  app.get('/api/admin/backups/:filename/plan', requireSessionOrCompany, requireRole(MASTER_ONLY), async (req: any, res) => {
    const { filename } = req.params;
    const corrId = `planner-${Date.now()}`;

    if (!acquireRestoreLock(corrId)) {
      const lockState = getRestoreLockState();
      return res.status(409).json({
        success: false,
        message: `Restore em andamento (correlationId: ${lockState.holder}). Aguarde antes de gerar o plano.`,
      });
    }

    if (!startJobRun("restore-planner")) {
      releaseRestoreLock(corrId);
      return res.status(409).json({ success: false, message: "Job restore-planner já em execução." });
    }

    try {
      logSecurity(`[RESTORE_PLANNER] started | file=${filename} | correlationId=${corrId}`);
      const result = await restorePlanner(filename);
      await auditLog(req, 'RESTORE_PLAN_GENERATED', `Plano de restore gerado: ${filename} — risco=${result.riskLevel} | tenants=${result.totalTenants}`, 'INFO');
      finishJobRun("restore-planner", true);
      res.json({ success: true, data: result });
    } catch (err: any) {
      logSecurity(`[RESTORE_PLANNER] error | file=${filename} | correlationId=${corrId} | err=${err?.message}`);
      finishJobRun("restore-planner", false, err?.message);
      incJobFailures();
      res.status(500).json({ success: false, message: err?.message ?? "Erro ao gerar plano de restore" });
    } finally {
      releaseRestoreLock(corrId);
    }
  });

  // ── Validate (MASTER only) ────────────────────────────────────
  app.post('/api/admin/backups/:filename/validate', requireSessionOrCompany, requireRole(MASTER_ONLY), async (req: any, res) => {
    try {
      const { filename } = req.params;
      const result = validateBackup(filename);
      await auditLog(req, 'BACKUP_VALIDATED', `Validação de backup: ${filename} — ${result.summary}`, result.valid ? 'INFO' : 'WARN');
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message ?? "Erro ao validar backup" });
    }
  });

  // ── Download ──────────────────────────────────────────────────
  app.get('/api/admin/backups/:filename', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (req: any, res) => {
    try {
      const { filename } = req.params;
      const filepath = getBackupPath(filename);
      if (!filepath) return res.status(404).json({ message: "Backup não encontrado" });
      const contentType = filename.endsWith('.sql') ? 'application/sql' : 'application/json';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Cache-Control', 'no-cache');
      await auditLog(req, 'BACKUP_DOWNLOAD', `Download de backup: ${filename}`);
      fs.createReadStream(filepath).pipe(res);
    } catch {
      res.status(500).json({ message: "Erro ao baixar backup" });
    }
  });

  // ── Delete ────────────────────────────────────────────────────
  app.delete('/api/admin/backups/:filename', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (req: any, res) => {
    try {
      const { filename } = req.params;
      const ok = deleteBackup(filename);
      if (!ok) return res.status(404).json({ message: 'Backup não encontrado' });
      await auditLog(req, 'BACKUP_DELETED', `Backup excluído: ${filename}`, 'WARN');
      res.json({ ok: true, message: 'Backup excluído.' });
    } catch (e: any) { res.status(500).json({ message: e?.message }); }
  });

  // ── Clean Old ─────────────────────────────────────────────────
  app.post('/api/admin/backups/clean-old', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (req: any, res) => {
    try {
      const removed = cleanOldBackups(30);
      await auditLog(req, 'BACKUPS_CLEANED', `${removed} backup(s) antigos removidos (>30 dias)`, 'WARN');
      res.json({ ok: true, removed, message: `${removed} backup(s) antigos removidos.` });
    } catch (e: any) { res.status(500).json({ message: e?.message }); }
  });
}
