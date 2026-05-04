import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { tenantContext, requireTenant } from "../middleware/tenant";
import { financeService } from "../modules/finance/finance.service";
import { financeRepository } from "../modules/finance/finance.repository";
import { uploadInMemory } from "../infra/upload";
import { auditLog } from "../utils/auditLogger";

export async function register(app: Express) {
  const { getItauExtrato, getItauSaldo, criarBoletItau, getItauConfigFromEnv } = await import('../services/financeiro/itauIntegration.ts');
  const { reconciliarTransacoes, resumoReconciliacao } = await import('../services/financeiro/bankReconciliation.ts');

  const getItauConfigFromAccount = (acc: any) => {
    if (acc.clientId && acc.clientSecret && acc.agencia && acc.conta) {
      return { clientId: acc.clientId, clientSecret: acc.clientSecret, agencia: acc.agencia, conta: acc.conta, ambiente: (acc.ambiente || 'sandbox') as 'sandbox' | 'producao' };
    }
    return getItauConfigFromEnv();
  };

  // GET /api/bank/accounts — requireTenant ensures tenantWhere() in storage never lacks context
  app.get('/api/bank/accounts', requireAuthCore, requireRole(["ADMIN", "FINANCE"]), tenantContext, requireTenant, async (req: any, res) => {
    try {
      const accounts = await storage.getBankAccounts();
      // Mask secrets before sending
      res.json(accounts.map(a => ({ ...a, clientSecret: a.clientSecret ? '***' : null })));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/bank/accounts — withTenant() stamps empresa_id
  app.post('/api/bank/accounts', requireAuthCore, requireRole(["ADMIN", "FINANCE"]), tenantContext, requireTenant, async (req: any, res) => {
    try {
      auditLog("CREATE_BANK_ACCOUNT", {
        userId: req.session?.userId,
        role: req.session?.userRole,
        entity: "bank_account",
        details: { nome: req.body.nome, banco: req.body.banco },
      });
      const acc = await storage.createBankAccount(req.body);
      res.status(201).json({ ...acc, clientSecret: acc.clientSecret ? '***' : null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // PATCH /api/bank/accounts/:id — tenantAnd() enforces ownership
  app.patch('/api/bank/accounts/:id', requireAuthCore, requireRole(["ADMIN", "FINANCE"]), tenantContext, requireTenant, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      auditLog("UPDATE_BANK_ACCOUNT", {
        userId: req.session?.userId,
        role: req.session?.userRole,
        entity: "bank_account",
        entityId: id,
        details: req.body,
      });
      const acc = await storage.updateBankAccount(id, req.body);
      res.json({ ...acc, clientSecret: acc.clientSecret ? '***' : null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // DELETE /api/bank/accounts/:id — tenantAnd() enforces ownership
  app.delete('/api/bank/accounts/:id', requireAuthCore, requireRole(["ADMIN", "FINANCE"]), tenantContext, requireTenant, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      auditLog("DELETE_BANK_ACCOUNT", {
        userId: req.session?.userId,
        role: req.session?.userRole,
        entity: "bank_account",
        entityId: id,
      });
      await storage.deleteBankAccount(id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/bank/accounts/:id/testar — testar conexão
  app.post('/api/bank/accounts/:id/testar', requireAuthCore, tenantContext, async (req: any, res) => {
    try {
      const acc = await storage.getBankAccount(Number(req.params.id));
      if (!acc) return res.status(404).json({ message: 'Conta não encontrada' });
      const config = getItauConfigFromAccount(acc);
      if (!config) return res.status(400).json({ message: 'Credenciais não configuradas. Informe Client ID, Client Secret, Agência e Conta.' });
      const saldo = await getItauSaldo(config);
      await storage.updateBankAccount(acc.id, { status: 'conectado', saldoAtual: String(saldo.saldo), ultimaSincronizacao: new Date() });
      res.json({ success: true, saldo: saldo.saldo, dataConsulta: saldo.dataConsulta });
    } catch (e: any) {
      await storage.updateBankAccount(Number(req.params.id), { status: 'erro' }).catch(() => {});
      res.status(500).json({ message: `Erro de conexão: ${e.message}` });
    }
  });

  // GET /api/bank/accounts/:id/extrato
  app.get('/api/bank/accounts/:id/extrato', requireAuthCore, tenantContext, async (req: any, res) => {
    try {
      const acc = await storage.getBankAccount(Number(req.params.id));
      if (!acc) return res.status(404).json({ message: 'Conta não encontrada' });
      const config = getItauConfigFromAccount(acc);
      if (!config) return res.status(400).json({ message: 'Credenciais não configuradas' });
      const { from, to } = req.query as Record<string, string>;
      const dataInicio = from || new Date(Date.now() - 30 * 86400000).toISOString().substring(0, 10);
      const dataFim = to || new Date().toISOString().substring(0, 10);
      const transacoes = await getItauExtrato(config, dataInicio, dataFim);

      // Persist new transactions
      for (const tx of transacoes) {
        if (tx.id) {
          await storage.upsertBankTransaction(tx.id, acc.id, {
            bankAccountId: acc.id, externalId: tx.id, tipo: tx.tipo,
            valor: String(tx.valor), data: tx.data, descricao: tx.descricao || '',
            documento: tx.documento || '', status: 'pendente',
          });
        }
      }
      await storage.updateBankAccount(acc.id, { ultimaSincronizacao: new Date(), saldoAtual: transacoes.length > 0 ? String(transacoes[0]!.saldoApos || 0) : undefined });
      res.json({ transacoes, periodo: { dataInicio, dataFim } });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/bank/transactions — persisted transactions
  app.get('/api/bank/transactions', requireAuthCore, tenantContext, async (req: any, res) => {
    try {
      const { bankAccountId, status, from, to } = req.query;
      const txs = await storage.getBankTransactions({ bankAccountId: bankAccountId ? Number(bankAccountId) : undefined, status: status as string, from: from as string, to: to as string });
      res.json(txs);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/bank/accounts/:id/boleto — emitir boleto
  app.post('/api/bank/accounts/:id/boleto', requireAuthCore, tenantContext, async (req: any, res) => {
    try {
      const acc = await storage.getBankAccount(Number(req.params.id));
      if (!acc) return res.status(404).json({ message: 'Conta não encontrada' });
      const config = getItauConfigFromAccount(acc);
      if (!config) return res.status(400).json({ message: 'Credenciais não configuradas' });
      const boleto = await criarBoletItau(config, {
        ...req.body,
        nossoNumero: req.body.nossoNumero || String(Date.now()).slice(-10),
      });
      res.status(201).json(boleto);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/bank/reconciliar — reconciliar com AR/AP
  app.post('/api/bank/reconciliar', requireAuthCore, tenantContext, async (req: any, res) => {
    try {
      const result = await reconciliarTransacoes(req.body);
      res.json(result);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}
