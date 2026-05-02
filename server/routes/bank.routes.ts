import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import { tenantContext } from "../middleware/tenant";
import { financeService } from "../modules/finance/finance.service";
import { financeRepository } from "../modules/finance/finance.repository";
import { uploadInMemory } from "../infra/upload";

export async function register(app: Express) {
  const { getItauExtrato, getItauSaldo, criarBoletItau, getItauConfigFromEnv } = await import('../services/financeiro/itauIntegration.ts');
  const { reconciliarTransacoes, resumoReconciliacao } = await import('../services/financeiro/bankReconciliation.ts');

  const getItauConfigFromAccount = (acc: any) => {
    if (acc.clientId && acc.clientSecret && acc.agencia && acc.conta) {
      return { clientId: acc.clientId, clientSecret: acc.clientSecret, agencia: acc.agencia, conta: acc.conta, ambiente: (acc.ambiente || 'sandbox') as 'sandbox' | 'producao' };
    }
    return getItauConfigFromEnv();
  };

  // GET /api/bank/accounts
  app.get('/api/bank/accounts', requireAuthCore, tenantContext, async (req: any, res) => {
    try {
      const accounts = await storage.getBankAccounts();
      // Mask secrets
      res.json(accounts.map(a => ({ ...a, clientSecret: a.clientSecret ? '***' : null })));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/bank/accounts
  app.post('/api/bank/accounts', requireAuthCore, tenantContext, async (req: any, res) => {
    try {
      const acc = await storage.createBankAccount(req.body);
      res.status(201).json({ ...acc, clientSecret: acc.clientSecret ? '***' : null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // PATCH /api/bank/accounts/:id
  app.patch('/api/bank/accounts/:id', requireAuthCore, tenantContext, async (req: any, res) => {
    try {
      const acc = await storage.updateBankAccount(Number(req.params.id), req.body);
      res.json({ ...acc, clientSecret: acc.clientSecret ? '***' : null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // DELETE /api/bank/accounts/:id
  app.delete('/api/bank/accounts/:id', requireAuthCore, tenantContext, async (req: any, res) => {
    try {
      await storage.deleteBankAccount(Number(req.params.id));
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
      const { bankAccountId, from, to } = req.body;
      const txs = await storage.getBankTransactions({ bankAccountId: bankAccountId ? Number(bankAccountId) : undefined, status: 'pendente', from, to });
      const arList = await storage.getAccountsReceivable({ status: 'pendente' });
      const apList = await storage.getAccountsPayable({ status: 'pendente' });

      const bankTxs = txs.map(t => ({ id: String(t.id), tipo: t.tipo as 'credito' | 'debito', valor: parseFloat(t.valor), data: t.data, descricao: t.descricao || '', documento: t.documento || '' }));
      const matches = reconciliarTransacoes(bankTxs, arList as any, apList as any);
      const resumo = resumoReconciliacao(matches);
      res.json({ matches, resumo });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/bank/reconciliar/confirmar — confirm a match
  app.post('/api/bank/reconciliar/confirmar', requireAuthCore, tenantContext, async (req: any, res) => {
    try {
      const { bankTxId, tipo, itemId } = req.body;
      // Mark transaction as reconciled
      await storage.updateBankTransaction(Number(bankTxId), {
        status: 'conciliado',
        contaReceivableId: tipo === 'ar' ? Number(itemId) : undefined,
        contaPayableId: tipo === 'ap' ? Number(itemId) : undefined,
      });
      // Mark AR/AP as paid
      // FASE FIN.3.5 — AR agora roteia pelo FinanceService para que o
      // hook `handleOrderPayment` (FIN.3) seja disparado também aqui na
      // conciliação bancária. Internamente, FinanceService delega ao
      // mesmo `storage.payAccountReceivable`, então o efeito de banco é
      // idêntico ao caminho anterior — adicionalmente, gera o log de
      // auditoria FINANCE_AR_PAY e o log [FIN.3] do pedido vinculado.
      // AP permanece intacto: não é escopo do FIN.3.
      if (tipo === 'ar') {
        await financeService.payAccountReceivable(
          Number(itemId),
          req.session.userId,
        );
      } else {
        await financeService.payAccountPayable(Number(itemId), req.session.userId);
      }
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // FASE BANCO.1 — POST /api/bank/remessa/itau
  // Geração de arquivo CNAB 240 de remessa para o Banco Itaú a partir de
  // IDs de accounts_receivable. Aditivo: apenas LÊ AR via repo existente
  // e devolve text/plain. Não altera status, schema ou módulo financeiro.
  app.post('/api/bank/remessa/itau', requireAuthCore, tenantContext, async (req: any, res) => {
    try {
      const { ids } = req.body ?? {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'Informe um array "ids" com pelo menos um ID de AR.' });
      }
      const arIds = ids.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n) && n > 0);
      if (arIds.length === 0) {
        return res.status(400).json({ message: 'Nenhum ID válido em "ids".' });
      }

      const { gerarRemessaItau } = await import('../modules/banking/itau/remessa.service');
      const config = await storage.getCompanyConfig().catch(() => null);
      const ctx = {
        cnpjCedente: (config as any)?.cnpj?.replace(/\D/g, '') || '00000000000000',
        nomeCedente: (config as any)?.companyName || 'EMPRESA',
        agencia: '0000',
        conta: '000000000000',
        dacConta: '0',
        nsa: 1,
        carteira: '109',
      };

      const result = await gerarRemessaItau(arIds, ctx);

      const filename = `remessa-itau-${Date.now()}.rem`;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-CNAB-Total-Titulos', String(result.totalTitulos));
      res.setHeader('X-CNAB-Ignorados-Pagos', String(result.ignoradosPagos));
      return res.status(200).send(result.conteudo);
    } catch (e: any) {
      console.error('[CNAB] erro ao gerar remessa Itaú', e);
      return res.status(500).json({ message: e.message });
    }
  });

  // FASE BANCO.3 — POST /api/bank/retorno/itau
  // Recebe arquivo .ret (multipart/form-data, campo "file"), parseia o
  // CNAB 240 de retorno do Itaú e dispara baixa automática nas AR
  // identificadas via financeService.payAccountReceivable (mesma rota
  // da conciliação manual — FIN.3.5). Fail-safe por item.
  app.post('/api/bank/retorno/itau', requireAuthCore, tenantContext, uploadInMemory.single('file'), async (req: any, res) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ message: 'Arquivo de retorno (.ret) ausente. Envie como multipart/form-data com campo "file".' });
      }
      const content = req.file.buffer.toString('utf-8');
      const { processarRetornoItau } = await import('../modules/banking/itau/retorno.service');
      const result = await processarRetornoItau(content, req.session.userId, {
        fileName: req.file.originalname,
        companyId: req.session.companyId ?? null,
      });
      return res.status(200).json(result);
    } catch (e: any) {
      console.error('[CNAB] erro ao processar retorno Itaú', e);
      return res.status(500).json({ message: e.message });
    }
  });

  // FASE BANCO.5 — GET /api/bank/retorno/historico
  // Lista os últimos 20 uploads de retorno CNAB (auditoria operacional).
  // Apenas leitura; não dispara nenhuma baixa.
  app.get('/api/bank/retorno/historico', requireAuthCore, tenantContext, async (req: any, res) => {
    try {
      const items = await financeRepository.listCnabImportHistory(20);
      return res.status(200).json(items);
    } catch (e: any) {
      console.error('[CNAB] erro ao listar histórico de retornos', e);
      return res.status(500).json({ message: e.message });
    }
  });
}
