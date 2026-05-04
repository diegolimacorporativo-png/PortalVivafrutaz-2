import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";

export function register(app: Express) {
  app.get('/api/system/versions', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    const versions = await storage.getSystemVersions();
    res.json(versions);
  });

  app.get('/api/system/versions/current', async (req: any, res) => {
    const version = await storage.getActiveSystemVersion();
    res.json(version ?? null);
  });

  app.post('/api/system/versions', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const version = await storage.createSystemVersion({
        ...req.body,
        criadoPor: actor.name || actor.email,
      });
      res.status(201).json(version);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch('/api/system/versions/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const version = await storage.updateSystemVersion(parseInt(req.params.id), req.body);
      res.json(version);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete('/api/system/versions/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    await storage.deleteSystemVersion(parseInt(req.params.id));
    res.json({ ok: true });
  });

  app.post('/api/system/apply-update', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const { versionId, empresaIds, aplicarTodas } = req.body;
      if (!versionId) return res.status(400).json({ message: 'versionId obrigatório' });

      const version = await storage.getSystemVersion(versionId);
      if (!version) return res.status(404).json({ message: 'Versão não encontrada' });

      let targets: number[] = [];
      if (aplicarTodas) {
        const allCompanies = await storage.getCompanies();
        targets = allCompanies
          .filter(c => {
            if (version.tipoVersao === 'beta') return (c as any).betaTester;
            return true;
          })
          .map(c => c.id);
      } else if (Array.isArray(empresaIds) && empresaIds.length > 0) {
        targets = empresaIds;
      } else {
        return res.status(400).json({ message: 'Selecione empresas ou marque aplicarTodas' });
      }

      const results: any[] = [];
      for (const empresaId of targets) {
        try {
          const upd = await storage.createSystemUpdate({
            versionId,
            empresaId,
            status: 'aplicado',
            detalhes: `Atualização para versão ${version.versionName} aplicada com sucesso`,
            aplicadoPor: actor.name || actor.email,
            dataAplicacao: new Date(),
          });
          await storage.updateCompany(empresaId, { currentVersion: version.versionName } as any);
          await storage.createUpdateLog({
            empresaId,
            versao: version.versionName,
            status: 'aplicado',
            detalhes: `Versão ${version.versionName} (${version.tipoVersao}) aplicada`,
            operador: actor.name || actor.email,
            dataAtualizacao: new Date(),
          });
          results.push({ empresaId, status: 'ok' });
        } catch(err: any) {
          await storage.createUpdateLog({
            empresaId,
            versao: version.versionName,
            status: 'erro',
            detalhes: err.message,
            operador: actor.name || actor.email,
            dataAtualizacao: new Date(),
          });
          results.push({ empresaId, status: 'erro', message: err.message });
        }
      }

      res.json({ message: `Atualização aplicada para ${results.filter(r => r.status === 'ok').length}/${targets.length} empresa(s)`, results });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/system/rollback', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const { empresaId, versionName } = req.body;
      if (!empresaId || !versionName) return res.status(400).json({ message: 'empresaId e versionName obrigatórios' });

      await storage.updateCompany(empresaId, { currentVersion: versionName } as any);
      await storage.createUpdateLog({
        empresaId,
        versao: versionName,
        status: 'rollback',
        detalhes: `Rollback para versão ${versionName} executado manualmente`,
        operador: actor.name || actor.email,
        dataAtualizacao: new Date(),
      });
      res.json({ message: `Rollback da empresa ${empresaId} para versão ${versionName} concluído` });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get('/api/system/update-logs', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    const { empresaId } = req.query;
    const logs = await storage.getUpdateLogs({
      empresaId: empresaId ? parseInt(empresaId as string) : undefined,
    });
    res.json(logs);
  });

  app.get('/api/system/updates', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    const { versionId, empresaId, status } = req.query;
    const updates = await storage.getSystemUpdates({
      versionId: versionId ? parseInt(versionId as string) : undefined,
      empresaId: empresaId ? parseInt(empresaId as string) : undefined,
      status: status as string | undefined,
    });
    res.json(updates);
  });
}
