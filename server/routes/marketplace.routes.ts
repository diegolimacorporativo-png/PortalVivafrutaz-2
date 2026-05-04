import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";

export function register(app: Express) {
  // ─── Marketplace: Módulos Disponíveis ─────────────────────────────────────
  app.get('/api/marketplace/modulos', async (req: any, res) => {
    try {
      const { categoria, ativo } = req.query;
      const filters: any = {};
      if (categoria) filters.categoria = String(categoria);
      if (ativo !== undefined) filters.ativo = ativo === 'true';
      const modulos = await storage.getModulosMarketplace(filters);
      res.json(modulos);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/marketplace/modulos', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const modulo = await storage.createModuloMarketplace(req.body);
      res.status(201).json(modulo);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch('/api/marketplace/modulos/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const modulo = await storage.updateModuloMarketplace(Number(req.params.id), req.body);
      res.json(modulo);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete('/api/marketplace/modulos/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      await storage.deleteModuloMarketplace(Number(req.params.id));
      res.json({ message: 'Módulo removido' });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/marketplace/seed', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const existentes = await storage.getModulosMarketplace();
      if (existentes.length > 0) return res.json({ message: 'Módulos já cadastrados', total: existentes.length });
      const seeds = [
        { nomeModulo: 'IA Logística', descricao: 'Otimização inteligente de rotas e entregas com IA', preco: '149.90', categoria: 'ia', icone: 'Brain', versao: '2.1.0', destaque: true, changelog: 'v2.1.0: Melhoria de 30% na precisão das rotas\nv2.0.0: Novo motor de otimização' },
        { nomeModulo: 'GPS Rastreamento', descricao: 'Rastreamento em tempo real de motoristas e entregas', preco: '89.90', categoria: 'logistica', icone: 'MapPin', versao: '1.5.0', destaque: true, changelog: 'v1.5.0: Histórico de 90 dias\nv1.4.0: Alertas de desvio de rota' },
        { nomeModulo: 'Relatórios Avançados', descricao: 'Dashboard executivo com gráficos e exportação Excel/PDF', preco: '69.90', categoria: 'financeiro', icone: 'BarChart3', versao: '3.0.0', destaque: false, changelog: 'v3.0.0: Novo designer de relatórios' },
        { nomeModulo: 'Integração API', descricao: 'API REST completa para integração com sistemas externos', preco: '199.90', categoria: 'integracao', icone: 'Plug', versao: '1.2.0', destaque: false, changelog: 'v1.2.0: Suporte a webhooks' },
        { nomeModulo: 'Automação de Rotas', descricao: 'Criação automática de rotas baseada em histórico', preco: '119.90', categoria: 'logistica', icone: 'Route', versao: '1.0.0', destaque: false, changelog: 'v1.0.0: Lançamento inicial' },
        { nomeModulo: 'NF-e Automática', descricao: 'Emissão automática de nota fiscal ao confirmar pedido', preco: '99.90', categoria: 'financeiro', icone: 'Receipt', versao: '2.0.0', destaque: true, changelog: 'v2.0.0: Suporte NF-e 4.0' },
        { nomeModulo: 'WhatsApp Notificações', descricao: 'Envio de notificações automáticas via WhatsApp', preco: '79.90', categoria: 'integracao', icone: 'MessageCircle', versao: '1.1.0', destaque: false, changelog: 'v1.1.0: Templates personalizados' },
        { nomeModulo: 'Controle de Desperdício IA', descricao: 'Previsão de desperdício com machine learning', preco: '129.90', categoria: 'ia', icone: 'TrendingDown', versao: '1.3.0', destaque: false, changelog: 'v1.3.0: Modelos preditivos melhorados' },
      ];
      const criados = [];
      for (const s of seeds) {
        const m = await storage.createModuloMarketplace(s as any);
        criados.push(m);
      }
      res.json({ message: `${criados.length} módulos criados`, modulos: criados });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── Marketplace: Módulos da Empresa ──────────────────────────────────────
  app.get('/api/marketplace/empresa/:empresaId', requireAuthCore, async (req: any, res) => {
    try {
      const modulos = await storage.getEmpresaModulos(Number(req.params.empresaId));
      res.json(modulos);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/marketplace/empresa/:empresaId/instalar/:moduloId', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const empresaId = Number(req.params.empresaId);
      const moduloId = Number(req.params.moduloId);
      const instalados = await storage.getEmpresaModulos(empresaId);
      const jaInstalado = instalados.find(m => m.moduloId === moduloId);
      if (jaInstalado) return res.status(409).json({ message: 'Módulo já instalado' });
      const modulo = await storage.installModuloEmpresa(empresaId, moduloId);
      res.status(201).json(modulo);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch('/api/marketplace/empresa-modulos/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      const modulo = await storage.updateEmpresaModulo(Number(req.params.id), req.body);
      res.json(modulo);
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete('/api/marketplace/empresa-modulos/:id', requireAuthCore, async (req: any, res) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    try {
      await storage.removeModuloEmpresa(Number(req.params.id));
      res.json({ message: 'Módulo removido da empresa' });
    } catch(e: any) { res.status(500).json({ message: e.message }); }
  });
}
