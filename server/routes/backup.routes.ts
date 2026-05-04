import type { Express } from "express";
import fs from "fs";
import { storage } from "../services/storage.ts";
import { runBackup, runBackupSQL, listBackups, getBackupPath, deleteBackup, cleanOldBackups } from "../services/backup.ts";
import { requireSessionOrCompany } from "../core/http/requireSessionOrCompany";
import { requireRole } from "../core/http/requireAuth";

const BACKUP_ROLES = ['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'];

export async function register(app: Express): Promise<void> {
  app.get('/api/admin/backups', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (_req, res) => {
    try {
      const backups = listBackups();
      res.json(backups);
    } catch (err) {
      res.status(500).json({ message: "Erro ao listar backups" });
    }
  });

  app.post('/api/admin/backups', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      const filename = await runBackup();
      await storage.createLog({ action: 'BACKUP_CREATED', description: `Backup JSON criado manualmente: ${filename}`, userId: user?.id, userEmail: user?.email, userRole: user?.role });
      res.status(201).json({ filename, message: "Backup JSON criado com sucesso." });
    } catch (err: any) {
      res.status(500).json({ message: "Erro ao criar backup: " + err?.message });
    }
  });

  app.post('/api/admin/backups/sql', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      const filename = await runBackupSQL();
      await storage.createLog({ action: 'BACKUP_CREATED', description: `Backup SQL criado manualmente: ${filename}`, userId: user?.id, userEmail: user?.email, userRole: user?.role });
      res.status(201).json({ filename, message: "Backup SQL criado com sucesso." });
    } catch (err: any) {
      res.status(500).json({ message: "Erro ao criar backup SQL: " + err?.message });
    }
  });

  app.get('/api/admin/backups/:filename', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      const filename = req.params.filename;
      const filepath = getBackupPath(filename);
      if (!filepath) return res.status(404).json({ message: "Backup não encontrado" });
      const contentType = filename.endsWith('.sql') ? 'application/sql' : 'application/json';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Cache-Control', 'no-cache');
      await storage.createLog({ action: 'BACKUP_DOWNLOAD', description: `Download de backup: ${filename}`, userId: user?.id, userEmail: user?.email, userRole: user?.role });
      fs.createReadStream(filepath).pipe(res);
    } catch (err: any) {
      res.status(500).json({ message: "Erro ao baixar backup" });
    }
  });

  app.delete('/api/admin/backups/:filename', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      const ok = deleteBackup(req.params.filename);
      if (!ok) return res.status(404).json({ message: 'Backup não encontrado' });
      await storage.createLog({ action: 'BACKUP_DELETED', description: `Backup excluído: ${req.params.filename}`, userId: user?.id, userEmail: user?.email, userRole: user?.role, level: 'WARN' });
      res.json({ ok: true, message: 'Backup excluído.' });
    } catch (e: any) { res.status(500).json({ message: e?.message }); }
  });

  app.post('/api/admin/backups/clean-old', requireSessionOrCompany, requireRole(BACKUP_ROLES), async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      const removed = cleanOldBackups(30);
      await storage.createLog({ action: 'BACKUPS_CLEANED', description: `${removed} backup(s) antigos removidos (>30 dias)`, userId: user?.id, userEmail: user?.email, userRole: user?.role, level: 'WARN' });
      res.json({ ok: true, removed, message: `${removed} backup(s) antigos removidos.` });
    } catch (e: any) { res.status(500).json({ message: e?.message }); }
  });
}
