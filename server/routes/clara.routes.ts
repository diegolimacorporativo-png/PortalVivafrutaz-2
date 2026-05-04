import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { AIDeveloper } from "../services/aiDeveloper.ts";
import { logSecurityEvent } from "../core/audit/security-logger";

const claraIA = new AIDeveloper();

export async function register(app: Express): Promise<void> {
  // --- Clara IA Routes ---
  // FASE 1 — Defesa-em-camadas: exige sessão admin (MASTER/ADMIN/DEVELOPER).
  // Endpoints exec código/treinam IA — não devem ser públicos.
  app.post('/api/clara/chat', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER']), async (req: any, res) => {
    try {
      const { message } = req.body;
      const currentUser = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      const userRole = currentUser?.role;
      const response = await claraIA.chat(message, userRole);
      res.json({ response });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/clara/learn', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER']), async (req, res) => {
    try {
      const { prompt, context, expectedOutput } = req.body;
      const result = await claraIA.learnFromPrompt({ prompt, context, expectedOutput });
      res.json({ message: result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/clara/fix-bug', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER']), async (req, res) => {
    try {
      const { errorMessage } = req.body;
      const suggestion = await claraIA.fixBug(errorMessage);
      res.json({ suggestion });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/clara/generate-module', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER']), async (req, res) => {
    try {
      const { name, description } = req.body;
      const code = await claraIA.generateModule(name, description);
      res.json({ code });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/clara/run-test', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER']), async (req, res) => {
    try {
      const { testName } = req.body;
      const result = await claraIA.runTest(testName);
      res.json({ result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/clara/iterative-learn', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER']), async (req, res) => {
    try {
      const { newPrompt } = req.body;
      const result = await claraIA.iterativeLearn(newPrompt);
      res.json({ message: result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get('/api/clara/recall/:key', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER']), async (req, res) => {
    try {
      const knowledge = await claraIA.recallKnowledge(req.params.key);
      res.json({ knowledge });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── CLARA SMART EXPORT ──────────────────────────────────────────────
  app.get('/api/clara/export', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR']), async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ message: 'Não autenticado' });
      const currentUser = await storage.getUser(userId);
      if (!currentUser) return res.status(401).json({ message: 'Não autenticado' });

      const XLSX = await import('xlsx');
      const { type = 'orders', period = 'week', companyId, status, format = 'excel' } = req.query as Record<string, string>;
      const now = new Date();
      let dateFrom: Date | null = null;
      let dateTo: Date | null = new Date();
      dateTo.setHours(23, 59, 59, 999);

      if (period === 'today') {
        dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (period === 'week') {
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
      } else if (period === 'month') {
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (period === 'lastmonth') {
        dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        dateTo = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      } else {
        dateFrom = null;
      }

      // CAMADA-1: resolve export scope before hitting the DB.
      // MASTER/ADMIN → cross-tenant allowed (explicit BI use); everyone else → own tenant only.
      const isMasterAdmin = ['MASTER', 'ADMIN'].includes(currentUser.role);
      const actorEmpresaId: number | null = (currentUser as any).empresaId ?? null;

      // Determine the company scope for this export:
      //   • explicit ?companyId param  → use it (admin chose a specific tenant)
      //   • non-MASTER without param   → own tenant (auto-scoped, fail if unknown)
      //   • MASTER/ADMIN without param → null = global cross-tenant export (documented intentional)
      let exportCompanyId: number | null = null;
      if (companyId) {
        exportCompanyId = parseInt(companyId);
      } else if (!isMasterAdmin) {
        if (!actorEmpresaId) {
          return res.status(403).json({ message: 'Empresa não identificada. Forneça ?companyId= para exportação.' });
        }
        exportCompanyId = actorEmpresaId;
      }
      // isMasterAdmin && !companyId → exportCompanyId stays null → global (CROSS-TENANT: intentional)

      // CROSS-TENANT NOTE: storage.getOrders() without arg is global — only reachable by MASTER/ADMIN above.
      const allOrders = exportCompanyId
        ? await storage.getOrders(exportCompanyId)
        : await storage.getOrders();
      const allCompanies = await storage.getCompanies();

      let orders = allOrders;
      if (dateFrom) orders = orders.filter((o: any) => new Date(o.orderDate || o.createdAt) >= dateFrom!);
      if (dateTo) orders = orders.filter((o: any) => new Date(o.orderDate || o.createdAt) <= dateTo!);
      // companyId tenant filter removed — already applied at DB level via exportCompanyId above.
      if (status) orders = orders.filter((o: any) => o.status === status.toUpperCase());

      const companyMap: Record<number, string> = {};
      for (const c of allCompanies) companyMap[c.id] = (c as any).companyName;

      let workbook: any;
      let filename = '';

      if (type === 'financial') {
        const rows = orders
          .filter((o: any) => o.status !== 'CANCELLED')
          .map((o: any) => ({
            'Código': o.orderCode,
            'Empresa': companyMap[o.companyId] || `#${o.companyId}`,
            'Data do Pedido': o.orderDate ? new Date(o.orderDate).toLocaleDateString('pt-BR') : '',
            'Data de Entrega': o.deliveryDate ? new Date(o.deliveryDate).toLocaleDateString('pt-BR') : '',
            'Semana': o.weekReference || '',
            'Valor Total (R$)': parseFloat(o.totalValue || '0'),
            'Status Fiscal': o.fiscalStatus || '',
            'Nota Fiscal': o.preNotaNumber || '',
            'Status ERP': o.erpExportStatus || '',
          }));
        const ws = XLSX.utils.json_to_sheet(rows);
        workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, ws, 'Faturamento');
        const total = rows.reduce((s: number, r: any) => s + r['Valor Total (R$)'], 0);
        XLSX.utils.sheet_add_aoa(ws, [['', '', '', '', 'TOTAL:', total]], { origin: -1 });
        filename = `faturamento_${period}_${now.toISOString().slice(0, 10)}.xlsx`;
      } else {
        const rows = orders.map((o: any) => ({
          'Código': o.orderCode,
          'Empresa': companyMap[o.companyId] || `#${o.companyId}`,
          'Status': o.status,
          'Data do Pedido': o.orderDate ? new Date(o.orderDate).toLocaleDateString('pt-BR') : '',
          'Data de Entrega': o.deliveryDate ? new Date(o.deliveryDate).toLocaleDateString('pt-BR') : '',
          'Semana': o.weekReference || '',
          'Valor Total (R$)': parseFloat(o.totalValue || '0'),
          'Observação': o.orderNote || '',
          'Nota Admin': o.adminNote || '',
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, ws, 'Pedidos');
        filename = `pedidos_${period}_${now.toISOString().slice(0, 10)}.xlsx`;
      }

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      // Log export
      await storage.createLog({ action: 'CLARA_EXPORT', description: `Exportação via Clara: tipo=${type}, período=${period}${exportCompanyId ? ', empresa=#' + exportCompanyId : ''}`, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role, level: 'INFO' });
      // CAMADA-2: persistent audit record for every data export.
      logSecurityEvent({
        userId: currentUser.id,
        companyId: exportCompanyId,
        role: currentUser.role,
        action: 'DATA_EXPORT',
        resource: '/api/clara/export',
        tenantScope: exportCompanyId ? 'SINGLE' : 'CROSS',
        intent: 'EXPORT_DATA',
        allowed: true,
        metadata: {
          format: 'excel',
          type,
          period,
          recordCount: orders.length,
          filters: { exportCompanyId, status: status ?? null },
        },
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err: any) {
      console.error('[Clara Export]', err);
      res.status(500).json({ message: 'Erro ao gerar exportação: ' + err.message });
    }
  });

  // ─── Clara Training ───────────────────────────────────────────────────────
  app.get('/api/clara-training', requireAuthCore, async (req: any, res) => {
    try {
      const trainings = await storage.getClaraTrainings();
      res.json(trainings);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/clara-training', requireAuthCore, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const { question, answer } = req.body;
      if (!question?.trim() || !answer?.trim()) return res.status(400).json({ message: 'Pergunta e resposta são obrigatórios' });
      const result = await storage.createClaraTraining({ question: question.trim(), answer: answer.trim(), userId: user.id, userName: user.name, active: true });
      res.json(result);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.put('/api/clara-training/:id', requireAuthCore, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      const { question, answer, active } = req.body;
      const result = await storage.updateClaraTraining(Number(req.params.id), { question: question?.trim(), answer: answer?.trim(), active });
      res.json(result);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete('/api/clara-training/:id', requireAuthCore, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });
      await storage.deleteClaraTraining(Number(req.params.id));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}
