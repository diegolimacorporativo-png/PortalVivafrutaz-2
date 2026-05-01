import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { checkBoletosVencidos } from "../modules/billing/billing.cron";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";

export async function register(app: Express): Promise<void> {
  // ─── SaaS: Bancos de Recebimento ────────────────────────────────────────────
  app.get('/api/saas/bancos', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DIRECTOR','GESTOR_CONTRATOS'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    const bancos = await storage.getBancosRecebimento();
    res.json(bancos);
  });

  app.post('/api/saas/bancos', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const banco = await storage.createBancoRecebimento(req.body);
      res.status(201).json(banco);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch('/api/saas/bancos/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const banco = await storage.updateBancoRecebimento(parseInt(req.params.id), req.body);
      res.json(banco);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete('/api/saas/bancos/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    await storage.deleteBancoRecebimento(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // ─── SaaS: Contratos de Clientes ────────────────────────────────────────────
  app.get('/api/saas/contratos', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DIRECTOR','GESTOR_CONTRATOS'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    const { empresaId, status } = req.query;
    const contratos = await storage.getContratosClientes({
      empresaId: empresaId ? parseInt(empresaId as string) : undefined,
      status: status as string | undefined,
    });
    res.json(contratos);
  });

  app.post('/api/saas/contratos', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','GESTOR_CONTRATOS'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const contrato = await storage.createContratoCliente(req.body);
      res.status(201).json(contrato);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch('/api/saas/contratos/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','GESTOR_CONTRATOS'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const contrato = await storage.updateContratoCliente(parseInt(req.params.id), req.body);
      res.json(contrato);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete('/api/saas/contratos/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    await storage.deleteContratoCliente(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // ─── SaaS: Faturas SaaS ──────────────────────────────────────────────────────
  app.get('/api/saas/faturas', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DIRECTOR','GESTOR_CONTRATOS'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    const { empresaId, status } = req.query;
    const faturas = await storage.getFaturasSaas({
      empresaId: empresaId ? parseInt(empresaId as string) : undefined,
      status: status as string | undefined,
    });
    res.json(faturas);
  });

  app.post('/api/saas/faturas', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','GESTOR_CONTRATOS'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const fatura = await storage.createFaturaSaas(req.body);
      res.status(201).json(fatura);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch('/api/saas/faturas/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','GESTOR_CONTRATOS'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const fatura = await storage.updateFaturaSaas(parseInt(req.params.id), req.body);
      res.json(fatura);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete('/api/saas/faturas/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    await storage.deleteFaturaSaas(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // ─── SaaS: Dashboard Stats ───────────────────────────────────────────────────
  app.get('/api/saas/dashboard', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DIRECTOR','GESTOR_CONTRATOS'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const [companies, planos, assinaturas, contratos, faturas] = await Promise.all([
        storage.getCompanies(),
        storage.getPlanos(),
        storage.getAssinaturas(),
        storage.getContratosClientes(),
        storage.getFaturasSaas(),
      ]);

      const now = new Date();
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();

      const empresasAtivas = assinaturas.filter(a => a.status === 'ativa').length;
      const empresasInadimplentes = assinaturas.filter(a => a.status === 'inadimplente').length;
      const contratosAtivos = contratos.filter(c => c.status === 'ativo').length;

      const faturamentoMensal = faturas
        .filter(f => f.status === 'pago' && f.dataPagamento &&
          new Date(f.dataPagamento).getMonth() === thisMonth &&
          new Date(f.dataPagamento).getFullYear() === thisYear)
        .reduce((sum, f) => sum + parseFloat(f.valor || '0'), 0);

      const faturamentoAnual = faturas
        .filter(f => f.status === 'pago' && f.dataPagamento &&
          new Date(f.dataPagamento).getFullYear() === thisYear)
        .reduce((sum, f) => sum + parseFloat(f.valor || '0'), 0);

      const faturasAtrasadas = faturas.filter(f => {
        if (f.status !== 'atrasado' && f.status !== 'pendente') return false;
        const dias = (now.getTime() - new Date(f.dataVencimento).getTime()) / 86400000;
        return dias > 15;
      }).length;

      const empresasPorPlano = planos.map(p => ({
        plano: p.nome,
        total: assinaturas.filter(a => a.planoId === p.id).length,
        ativas: assinaturas.filter(a => a.planoId === p.id && a.status === 'ativa').length,
      }));

      res.json({
        totalEmpresas: companies.length,
        empresasAtivas,
        empresasInadimplentes,
        contratosAtivos,
        faturamentoMensal,
        faturamentoAnual,
        faturasAtrasadas,
        empresasPorPlano,
      });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── SaaS: Uso do Plano por Empresa ─────────────────────────────────────────
  app.get('/api/saas/uso/:empresaId', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DIRECTOR','GESTOR_CONTRATOS'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const empresaId = parseInt(req.params.empresaId);
      const assinatura = (await storage.getAssinaturas()).find(a => a.companyId === empresaId);
      const plano = assinatura?.planoId ? (await storage.getPlanos()).find(p => p.id === assinatura.planoId) : null;

      const [usuarios, pedidos, motoristas, rotas] = await Promise.all([
        storage.getUsers(),
        storage.getOrders(),
        storage.getDrivers(),
        storage.getRoutes(),
      ]);

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const uso = {
        usuarios: usuarios.filter(u => (u as any).companyId === empresaId).length,
        pedidosMes: pedidos.filter(p => (p as any).companyId === empresaId && new Date(p.createdAt) >= startOfMonth).length,
        motoristas: motoristas.filter(m => (m as any).companyId === empresaId).length,
        rotas: rotas.filter(r => (r as any).companyId === empresaId).length,
      };

      const limites = {
        usuarios: plano?.limiteUsuarios ?? 999,
        pedidosMes: plano?.limitePedidos ?? 999,
        motoristas: plano?.limiteMotoristas ?? 999,
        rotas: plano?.limiteRotas ?? 999,
      };

      const alertas = [];
      if (uso.usuarios / limites.usuarios > 0.8) alertas.push('Limite de usuários próximo (80%)');
      if (uso.pedidosMes / limites.pedidosMes > 0.8) alertas.push('Limite de pedidos próximo (80%)');
      if (uso.motoristas / limites.motoristas > 0.8) alertas.push('Limite de motoristas próximo (80%)');

      res.json({ uso, limites, alertas, plano, assinatura });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── SaaS: Reajuste IPCA ──────────────────────────────────────────────────────
  app.post('/api/saas/reajuste-ipca', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','GESTOR_CONTRATOS'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const { indiceIpca } = req.body;
      if (!indiceIpca) return res.status(400).json({ message: 'indiceIpca obrigatório' });

      const contratos = await storage.getContratosClientes({ status: 'ativo' });
      let atualizados = 0;
      for (const c of contratos) {
        const novoValor = parseFloat(c.valorContrato) * (1 + indiceIpca / 100);
        await storage.updateContratoCliente(c.id, {
          valorContrato: novoValor.toFixed(2),
          indiceReajuste: indiceIpca.toFixed(2),
        });
        atualizados++;
      }
      res.json({ message: `${atualizados} contrato(s) reajustado(s) pelo IPCA de ${indiceIpca}%`, atualizados });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── SaaS: Verificar Inadimplência e Suspender ───────────────────────────────
  app.post('/api/saas/verificar-inadimplencia', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const faturas = await storage.getFaturasSaas();
      const now = new Date();
      const suspensos: number[] = [];

      for (const f of faturas) {
        if (f.status === 'pendente' || f.status === 'atrasado') {
          const diasAtraso = (now.getTime() - new Date(f.dataVencimento).getTime()) / 86400000;
          if (diasAtraso > 15) {
            await storage.updateFaturaSaas(f.id, { status: 'atrasado' });
            const assinaturas = await storage.getAssinaturas();
            const assinatura = assinaturas.find(a => a.companyId === f.empresaId);
            if (assinatura && assinatura.status !== 'suspensa') {
              await storage.updateAssinatura(assinatura.id, { status: 'inadimplente' });
              suspensos.push(f.empresaId);
            }
          }
        }
      }
      res.json({ message: `${suspensos.length} empresa(s) marcada(s) como inadimplente`, suspensos });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── SaaS: Módulos do Sistema ────────────────────────────────────────────────
  app.get('/api/saas/modulos', async (req: any, res) => {
    try {
      const modulos = await storage.getModulosSistema();
      res.json(modulos);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/saas/modulos', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN'].includes(actor.role)) return res.status(403).json({ message: 'Acesso negado' });
    try {
      const modulo = await storage.createModuloSistema(req.body);
      res.status(201).json(modulo);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch('/api/saas/modulos/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN'].includes(actor.role)) return res.status(403).json({ message: 'Acesso negado' });
    try {
      const modulo = await storage.updateModuloSistema(parseInt(req.params.id), req.body);
      res.json(modulo);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete('/api/saas/modulos/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN'].includes(actor.role)) return res.status(403).json({ message: 'Acesso negado' });
    try {
      await storage.deleteModuloSistema(parseInt(req.params.id));
      res.json({ ok: true });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── SaaS: Plano × Módulos ───────────────────────────────────────────────────
  app.get('/api/saas/planos/:id/modulos', async (req: any, res) => {
    try {
      const modulos = await storage.getModulosByPlano(parseInt(req.params.id));
      res.json(modulos);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/saas/planos/:id/modulos', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN'].includes(actor.role)) return res.status(403).json({ message: 'Acesso negado' });
    try {
      const { moduloIds } = req.body;
      await storage.setModulosForPlano(parseInt(req.params.id), moduloIds || []);
      const modulos = await storage.getModulosByPlano(parseInt(req.params.id));
      res.json(modulos);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── SaaS: Minha Assinatura (empresa autenticada) ────────────────────────────
  app.get('/api/saas/minha-assinatura', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const companyId = (actor as any).companyId;
      if (!companyId) return res.json(null);
      const assinatura = await storage.getAssinaturaByCompany(companyId);
      if (!assinatura) return res.json(null);
      const plano = assinatura.planoId ? await storage.getPlano(assinatura.planoId) : null;
      res.json({ ...assinatura, plano });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get('/api/saas/minha-assinatura/modulos', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const companyId = (actor as any).companyId;
      if (!companyId) return res.json([]);
      const chaves = await storage.getModuloChavesByCompany(companyId);
      res.json(chaves);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── SaaS: Processar Pagamento de Assinatura ────────────────────────────────
  app.post('/api/saas/assinaturas/:id/pagar', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','GESTOR_CONTRATOS'].includes(actor.role)) return res.status(403).json({ message: 'Acesso negado' });
    try {
      const id = parseInt(req.params.id);
      const { metodo } = req.body;
      const assinatura = await storage.getAssinatura(id);
      if (!assinatura) return res.status(404).json({ message: 'Assinatura não encontrada' });

      const now = new Date();
      const vencimento30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      let updates: any = { metodoPagamento: metodo };
      let resposta: any = { metodo };

      if (metodo === 'pix') {
        const pixId = `PIX-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
        const qrCode = `00020126580014BR.GOV.BCB.PIX0136${pixId}5204000053039865405${assinatura.valor || '0.00'}5802BR5920VivaFrutaz SaaS6009SAO PAULO62290525${pixId}6304`;
        updates = { ...updates, pixChave: pixId, pixQrCode: qrCode, status: 'trial', dataVencimento: vencimento30 };
        resposta = { ...resposta, pixQrCode: qrCode, pixChave: pixId, instrucao: 'Escaneie o QR Code para confirmar o pagamento PIX.' };
      } else if (metodo === 'cartao') {
        updates = { ...updates, status: 'ativa', dataPagamento: now, dataExpiracao: vencimento30, dataVencimento: vencimento30 };
        await storage.createBillingEvent({ companyId: assinatura.companyId, assinaturaId: id, tipo: 'pagamento', valor: assinatura.valor, status: 'pago', gateway: 'cartao', descricao: 'Pagamento via cartão processado' });
        resposta = { ...resposta, status: 'ativa', mensagem: 'Pagamento via cartão aprovado. Assinatura ativada.' };
      } else if (metodo === 'boleto') {
        const linhaDigitavel = `34191.75203 15708.051300 01028.550000 3 ${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')} ${String(parseFloat(assinatura.valor || '0') * 100).padStart(10,'0')}`;
        updates = { ...updates, status: 'trial', linhaDigitavel, dataVencimento: vencimento30 };
        await storage.createBillingEvent({ companyId: assinatura.companyId, assinaturaId: id, tipo: 'pagamento', valor: assinatura.valor, status: 'pendente', gateway: 'boleto', descricao: 'Boleto gerado — aguardando pagamento' });
        resposta = { ...resposta, linhaDigitavel, vencimento: vencimento30, instrucao: 'Pague o boleto até o vencimento. O acesso será liberado após confirmação.' };
      } else {
        return res.status(400).json({ message: 'Método de pagamento inválido. Use: pix | cartao | boleto' });
      }

      const assinaturaAtualizada = await storage.updateAssinatura(id, updates);
      res.json({ ...resposta, assinatura: assinaturaAtualizada });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── SaaS: Confirmar PIX ─────────────────────────────────────────────────────
  app.post('/api/saas/assinaturas/:id/confirmar-pix', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN'].includes(actor.role)) return res.status(403).json({ message: 'Acesso negado' });
    try {
      const id = parseInt(req.params.id);
      const now = new Date();
      const vencimento30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const assinatura = await storage.updateAssinatura(id, { status: 'ativa', dataPagamento: now, dataExpiracao: vencimento30 });
      const a = await storage.getAssinatura(id);
      await storage.createBillingEvent({ companyId: a!.companyId, assinaturaId: id, tipo: 'pagamento', valor: a!.valor, status: 'pago', gateway: 'pix', descricao: 'PIX confirmado manualmente' });
      res.json({ ok: true, assinatura });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── SaaS: Upgrade de Plano ──────────────────────────────────────────────────
  app.post('/api/saas/assinaturas/:id/upgrade', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','GESTOR_CONTRATOS'].includes(actor.role)) return res.status(403).json({ message: 'Acesso negado' });
    try {
      const id = parseInt(req.params.id);
      const { novoPlanoId, metodo } = req.body;
      const planoNovo = await storage.getPlano(novoPlanoId);
      if (!planoNovo) return res.status(404).json({ message: 'Plano não encontrado' });
      const now = new Date();
      const vencimento30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const assinatura = await storage.updateAssinatura(id, {
        planoId: novoPlanoId,
        valor: planoNovo.preco,
        status: metodo === 'cartao' ? 'ativa' : 'trial',
        dataExpiracao: vencimento30,
        dataVencimento: vencimento30,
        metodoPagamento: metodo,
        dataPagamento: metodo === 'cartao' ? now : undefined,
      });
      const a = await storage.getAssinatura(id);
      await storage.createBillingEvent({ companyId: a!.companyId, assinaturaId: id, tipo: 'upgrade', valor: planoNovo.preco, status: metodo === 'cartao' ? 'pago' : 'pendente', gateway: metodo, descricao: `Upgrade para ${planoNovo.nome}` });
      res.json({ ok: true, assinatura, plano: planoNovo });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── SaaS: Verificar Boletos Vencidos (auto-check) ───────────────────────────
  app.post('/api/saas/check-boletos', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN'].includes(actor.role)) return res.status(403).json({ message: 'Acesso negado' });
    try {
      const result = await checkBoletosVencidos();
      res.json(result);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── SaaS: Seed Módulos Padrão ───────────────────────────────────────────────
  app.post('/api/saas/seed-modulos', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN'].includes(actor.role)) return res.status(403).json({ message: 'Acesso negado' });
    try {
      const existentes = await storage.getModulosSistema();
      if (existentes.length > 0) return res.json({ message: 'Módulos já cadastrados', total: existentes.length });

      const modulosPadrao = [
        { chave: 'dashboard', nomeModulo: 'Dashboard', rota: '/admin', descricao: 'Painel principal', icone: 'LayoutDashboard', categoria: 'geral' },
        { chave: 'clientes', nomeModulo: 'Clientes / Empresas', rota: '/admin/companies', descricao: 'Gestão de clientes', icone: 'Building2', categoria: 'geral' },
        { chave: 'produtos', nomeModulo: 'Produtos', rota: '/admin/products', descricao: 'Catálogo de produtos', icone: 'Package', categoria: 'geral' },
        { chave: 'pedidos', nomeModulo: 'Pedidos', rota: '/admin/orders', descricao: 'Gestão de pedidos', icone: 'ShoppingCart', categoria: 'geral' },
        { chave: 'contratos', nomeModulo: 'Contratos', rota: '/admin/contracts', descricao: 'Escopos contratuais', icone: 'FileText', categoria: 'geral' },
        { chave: 'compras', nomeModulo: 'Planejamento de Compras', rota: '/admin/purchase-planning', descricao: 'Compras e fornecedores', icone: 'ShoppingBag', categoria: 'geral' },
        { chave: 'estoque', nomeModulo: 'Estoque', rota: '/admin/inventory', descricao: 'Controle de inventário', icone: 'Warehouse', categoria: 'geral' },
        { chave: 'fiscal', nomeModulo: 'Notas Fiscais', rota: '/admin/fiscal', descricao: 'Emissão e gestão de NF-e', icone: 'Receipt', categoria: 'financeiro' },
        { chave: 'financeiro', nomeModulo: 'Financeiro', rota: '/admin/financial', descricao: 'Contas a pagar e receber', icone: 'DollarSign', categoria: 'financeiro' },
        { chave: 'relatorios', nomeModulo: 'Relatórios', rota: '/admin/reports', descricao: 'Análises e relatórios', icone: 'BarChart3', categoria: 'geral' },
        { chave: 'logistica', nomeModulo: 'Logística', rota: '/admin/logistics', descricao: 'Rotas e motoristas', icone: 'Truck', categoria: 'logistica' },
        { chave: 'logistica_inteligente', nomeModulo: 'Logística Inteligente', rota: '/admin/logistics-intelligence', descricao: 'IA para logística', icone: 'Brain', categoria: 'logistica' },
        { chave: 'gps', nomeModulo: 'GPS em Tempo Real', rota: '/admin/driver-panel', descricao: 'Rastreamento GPS', icone: 'Route', categoria: 'logistica' },
        { chave: 'motoristas', nomeModulo: 'Motoristas', rota: '/admin/logistics', descricao: 'Gestão de motoristas', icone: 'Truck', categoria: 'logistica' },
        { chave: 'ia', nomeModulo: 'Clara IA', rota: '/admin/ai-developer', descricao: 'Assistente de IA', icone: 'Bot', categoria: 'admin' },
        { chave: 'configuracoes', nomeModulo: 'Configurações', rota: '/admin/settings', descricao: 'Configurações do sistema', icone: 'Settings', categoria: 'admin' },
      ];

      const criados = [];
      for (const m of modulosPadrao) {
        const mod = await storage.createModuloSistema(m);
        criados.push(mod);
      }

      res.json({ message: `${criados.length} módulos criados com sucesso`, modulos: criados });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── SaaS: Métricas Financeiras ──────────────────────────────────────────────
  app.get('/api/saas/financeiro', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const metrics = await storage.computeAndSaveSaasMetrics();
      res.json(metrics);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get('/api/saas/financeiro/historico', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const { db: dbConn } = await import('../database/db');
      const { saasMetrics: sm } = await import('@shared/schema');
      const { desc: descOrd } = await import('drizzle-orm');
      const rows = await dbConn.select().from(sm).orderBy(descOrd(sm.createdAt)).limit(12);
      res.json(rows);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });
}
