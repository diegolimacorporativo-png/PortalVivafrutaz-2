import type { Express } from "express";
import { storage } from "../services/storage.ts";

export function register(app: Express) {
  // GET /api/sanitary/plan-status — retorna nível de acesso ao módulo sanitário
  app.get('/api/sanitary/plan-status', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor) return res.status(401).json({ message: 'Usuário não encontrado' });

    // Admins/directors/devs e NUTRICIONISTA sempre têm acesso completo
    // (NUTRICIONISTA é o papel exclusivo do módulo sanitário — acesso irrestrito)
    if (['ADMIN', 'DIRECTOR', 'DEVELOPER', 'MASTER', 'NUTRICIONISTA'].includes(actor.role)) {
      return res.json({ enabled: true, level: 'full' });
    }

    try {
      const assinaturasList = await storage.getAssinaturas({ status: 'ativa' });
      const assinatura = assinaturasList[0];

      if (!assinatura || !assinatura.planoId) {
        // Sem assinatura ativa: NUTRICIONISTA tem acesso completo, outros só relatórios
        if (actor.role === 'NUTRICIONISTA') return res.json({ enabled: true, level: 'full' });
        return res.json({ enabled: true, level: 'readonly' });
      }

      const plano = await storage.getPlano(assinatura.planoId);
      if (!plano) return res.json({ enabled: false, level: 'none' });

      // Verificar via plano_modulos (sistema correto de módulos)
      const modulos = await storage.getModulosByPlano(assinatura.planoId);
      const chaves = modulos.map((m: any) => m.chave);

      // Verificar também via modulosHabilitados (campo legado)
      const habilitados: string[] = (plano.modulosHabilitados as string[]) || [];

      const hasFull = chaves.includes('vigilancia_sanitaria') || habilitados.includes('vigilancia-sanitaria') || habilitados.includes('vigilancia_sanitaria');
      const hasReadonly = chaves.includes('vigilancia_sanitaria_relatorios') || habilitados.includes('vigilancia-sanitaria-relatorios') || habilitados.includes('vigilancia_sanitaria_relatorios');

      if (hasFull) {
        const level = actor.role === 'NUTRICIONISTA' ? 'full' : 'readonly';
        return res.json({ enabled: true, level });
      } else if (hasReadonly) {
        return res.json({ enabled: true, level: 'readonly' });
      } else {
        return res.json({ enabled: false, level: 'none' });
      }
    } catch {
      // Fallback: permite acesso
      if (actor.role === 'NUTRICIONISTA') return res.json({ enabled: true, level: 'full' });
      return res.json({ enabled: true, level: 'readonly' });
    }
  });

  // GET /api/sanitary/questions
  app.get('/api/sanitary/questions', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const questions = await storage.getSanitaryQuestions();
      res.json(questions);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/sanitary/questions
  app.post('/api/sanitary/questions', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['ADMIN', 'DIRECTOR', 'DEVELOPER', 'NUTRICIONISTA'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado: apenas Nutricionista ou Admin' });
    }
    try {
      const q = await storage.createSanitaryQuestion(req.body);
      res.status(201).json(q);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // PATCH /api/sanitary/questions/:id
  app.patch('/api/sanitary/questions/:id', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['ADMIN', 'DIRECTOR', 'DEVELOPER', 'NUTRICIONISTA'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado: apenas Nutricionista ou Admin' });
    }
    try {
      const q = await storage.updateSanitaryQuestion(Number(req.params.id), req.body);
      res.json(q);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // DELETE /api/sanitary/questions/:id
  app.delete('/api/sanitary/questions/:id', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['ADMIN', 'DIRECTOR', 'DEVELOPER', 'NUTRICIONISTA'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado: apenas Nutricionista ou Admin' });
    }
    try {
      await storage.deleteSanitaryQuestion(Number(req.params.id));
      res.json({ message: 'Pergunta removida' });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/sanitary/evaluations
  app.get('/api/sanitary/evaluations', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const evals = await storage.getSanitaryEvaluations();
      res.json(evals);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/sanitary/evaluations/:id
  app.get('/api/sanitary/evaluations/:id', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const ev = await storage.getSanitaryEvaluation(Number(req.params.id));
      if (!ev) return res.status(404).json({ message: 'Avaliação não encontrada' });
      res.json(ev);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/sanitary/evaluations — cria avaliação e popula itens a partir das perguntas ativas
  app.post('/api/sanitary/evaluations', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['ADMIN', 'DIRECTOR', 'DEVELOPER', 'NUTRICIONISTA', 'OPERATIONS_MANAGER'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const { title, notes, companyId } = req.body;
      const evaluation = await storage.createSanitaryEvaluation({
        title: title || 'Nova Avaliação Sanitária',
        evaluatorId: actor.id,
        evaluatorName: actor.name,
        companyId: companyId || null,
        status: 'em_andamento',
        notes: notes || null,
        evaluationDate: new Date(),
      });
      // Populate items from active questions
      const questions = await storage.getSanitaryQuestions();
      const activeQuestions = questions.filter(q => q.active);
      if (activeQuestions.length > 0) {
        await storage.bulkCreateSanitaryEvaluationItems(
          activeQuestions.map(q => ({
            evaluationId: evaluation.id,
            questionId: q.id,
            questionText: q.question,
            questionCategory: q.category,
            result: null,
            observation: null,
          }))
        );
      }
      const detail = await storage.getSanitaryEvaluation(evaluation.id);
      res.status(201).json(detail);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // PATCH /api/sanitary/evaluations/:id — atualiza status/notas/score
  app.patch('/api/sanitary/evaluations/:id', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['ADMIN', 'DIRECTOR', 'DEVELOPER', 'NUTRICIONISTA', 'OPERATIONS_MANAGER'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const ev = await storage.updateSanitaryEvaluation(Number(req.params.id), req.body);
      res.json(ev);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // PATCH /api/sanitary/evaluations/:id/items/:itemId — responde item
  app.patch('/api/sanitary/evaluations/:id/items/:itemId', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['ADMIN', 'DIRECTOR', 'DEVELOPER', 'NUTRICIONISTA', 'OPERATIONS_MANAGER'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const item = await storage.updateSanitaryEvaluationItem(Number(req.params.itemId), {
        result: req.body.result,
        observation: req.body.observation,
      });
      res.json(item);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });
}
