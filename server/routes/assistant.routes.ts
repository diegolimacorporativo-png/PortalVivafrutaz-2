import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { db } from "../database/db.ts";
import { logSecurityEvent } from "../core/audit/security-logger";
import { aiInteractions } from "@shared/schema";
import { tenantContext } from "../middleware/tenant";
import { tenantWhere, crossTenant } from "../core/tenant/scope";
import { currentTenantId } from "../core/tenant/context";
import { desc } from "drizzle-orm";
import { fireNotification } from "../services/pushService";
// FASE 14.5 — Clara IA MUST use the provisioning service; direct storage.createCompany is forbidden
import { createCompanyFromClaraAI } from "../modules/auth/userProvisioningService";
// FASE MT-1 — tenant-safe query routing for Clara IA (eliminates P0 cross-tenant bypass)
import { routeGetOrders, routeGetRoutes } from "../core/tenant/safeQueryRouter";

export function register(app: Express) {
  // ─── IA ASSISTENTE VIRTUAL (Interactive AI Chat) ──────────────
  // SECURITY: tenantContext resolves the principal; tenantWhere(aiInteractions)
  // scopes the read to the current tenant. MASTER without a target tenant sees
  // an empty list — they must pass ?empresaId=N to inspect a specific tenant.
  app.get('/api/assistant/history', tenantContext, async (req: any, res) => {
    try {
      const tenantId = currentTenantId();
      // Cross-tenant admins (MASTER without ?empresaId) get nothing — there is
      // no "global AI history" view; they must scope to a tenant explicitly.
      if (tenantId == null) {
        return res.json([]);
      }
      const rows = await db.select().from(aiInteractions)
        .where(tenantWhere(aiInteractions))
        .orderBy(desc(aiInteractions.createdAt))
        .limit(50);
      // Within a tenant, company-portal users only see their company's
      // interactions; admin-portal users see everything in the tenant.
      const filtered = req.session?.companyId
        ? rows.filter((r: any) => r.companyId === req.session.companyId)
        : rows;
      res.json(filtered);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // MT-3B M1 — tenantContext middleware pins the request's tenant to AsyncLocalStorage,
  // replacing the manual derivation that followed. Fail-closed: unauthenticated calls
  // still reach the explicit 401 guard inside the handler.
  app.post('/api/assistant/chat', tenantContext, async (req: any, res) => {
    const isUser = !!req.session?.userId;
    const isCompany = !!req.session?.companyId;
    if (!isUser && !isCompany) return res.status(401).json({ message: 'Não autenticado' });

    const { message, sessionContext } = req.body;
    if (!message || typeof message !== 'string') return res.status(400).json({ message: 'Mensagem inválida' });

    const msg = message.trim().toLowerCase();

    let user: any = null;
    let company: any = null;
    if (isUser) user = await storage.getUser(req.session.userId);
    if (isCompany) company = await storage.getCompany(req.session.companyId);

    const isAdmin = user && ['ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role);
    const isInternal = !!user;

    // MT-3B M1 — tenant resolved from official AsyncLocalStorage context set by
    // tenantContext middleware (eliminates manual derivation from session fields
    // that could diverge from the authoritative middleware resolution).
    const tenantId = currentTenantId();

    // MT-3B M4 — admin intents that follow (companies, products, inventory, orders)
    // perform intentional cross-tenant reads when MASTER/ADMIN has no empresaId.
    // Explicit marker so grep for crossTenant() surfaces every legitimate bypass.
    if (isInternal) void crossTenant();

    // CAMADA-2: log every AI data access for full auditability.
    logSecurityEvent({
      userId: user?.id,
      companyId: tenantId,
      role: user?.role,
      action: 'AI_DATA_ACCESS',
      resource: '/api/assistant/chat',
      tenantScope: tenantId ? 'SINGLE' : 'CROSS',
      intent: 'AI_DATA_ACCESS',
      allowed: true,
      metadata: {
        promptType: msg.split(' ').slice(0, 3).join(' '),
        datasetsUsed: ['orders', 'users', 'routes'],
        tenantId,
        isAdmin: isAdmin,
      },
    });

    // Tenant-safe wrappers — used by every isInternal data-fetching intent below.
    // Returns [] when tenantId is unresolvable so responses degrade gracefully
    // without ever falling back to a full-table scan.
    const safeGetOrders = (): Promise<any[]> =>
      tenantId ? routeGetOrders(tenantId) : Promise.resolve([]);
    const safeGetRoutes = (): Promise<any[]> =>
      tenantId ? routeGetRoutes(tenantId) : Promise.resolve([]);

    let intent = 'unknown';
    let response = '';
    let newContext: any = null;
    let actionExecuted: string | null = null;
    let actionData: any = null;

    // ── Multi-turn: create company flow ────────────────────────────
    if (sessionContext?.action === 'create_company') {
      const step = sessionContext.step;
      const data = sessionContext.data || {};

      if (msg === 'cancelar' || msg === 'cancela' || msg === 'não' || msg === 'nao') {
        intent = 'cancel';
        response = '❌ Criação de empresa cancelada.';
        newContext = null;
      } else if (step === 'name') {
        data.name = message.trim();
        newContext = { action: 'create_company', step: 'cnpj', data };
        intent = 'create_company';
        response = `✅ Nome: **${data.name}**\n\nAgora informe o **CNPJ** da empresa (ou "pular" para deixar em branco):`;
      } else if (step === 'cnpj') {
        data.cnpj = msg === 'pular' ? null : message.trim();
        newContext = { action: 'create_company', step: 'email', data };
        intent = 'create_company';
        response = `✅ CNPJ: ${data.cnpj || '(em branco)'}\n\nAgora informe o **e-mail de acesso** da empresa (ex: empresa01):`;
      } else if (step === 'email') {
        const emailInput = message.trim().toLowerCase();
        const email = emailInput.endsWith('@vivafrutaz.com') ? emailInput : emailInput + '@vivafrutaz.com';
        data.email = email;
        newContext = { action: 'create_company', step: 'contact', data };
        intent = 'create_company';
        response = `✅ E-mail: **${email}**\n\nInforme o **nome do contato** responsável (ou "pular"):`;
      } else if (step === 'contact') {
        data.contactName = msg === 'pular' ? data.name : message.trim();
        newContext = { action: 'create_company', step: 'confirm', data };
        intent = 'create_company';
        response = `📋 **Resumo da nova empresa:**\n\n• Nome: ${data.name}\n• CNPJ: ${data.cnpj || '—'}\n• E-mail: ${data.email}\n• Contato: ${data.contactName}\n\nDigite **"confirmar"** para criar ou **"cancelar"** para desistir.`;
      } else if (step === 'confirm' && (msg === 'confirmar' || msg === 'sim' || msg === 'ok')) {
        try {
          const existing = await storage.getCompanyByEmail(data.email);
          if (existing) {
            response = `⚠️ Já existe uma empresa com o e-mail **${data.email}**. Tente outro e-mail.`;
            newContext = { action: 'create_company', step: 'email', data };
          } else {
            // FASE 14.5 — use provisioning service; never create company with hardcoded password
            const ip = (req.headers['x-forwarded-for'] as string || '').split(',')[0] || req.socket?.remoteAddress || '';
            const { company: newComp, tempPassword } = await createCompanyFromClaraAI({
              companyName: data.name,
              contactName: data.contactName || data.name,
              email: data.email,
              cnpj: data.cnpj || null,
              createdByUserId: user?.id,
              ip,
            });
            actionExecuted = 'create_company';
            actionData = { companyId: newComp.id, companyName: data.name };
            intent = 'create_company_done';
            response = `✅ **Empresa criada com sucesso!**\n\n• ID: #${newComp.id}\n• Nome: ${data.name}\n• E-mail: ${data.email}\n• Senha temporária: \`${tempPassword}\`\n\n⚠️ **Importante:** Esta senha é de uso único. A empresa será obrigada a criar uma nova senha no primeiro login.\n\nAcesse Empresas para configurar preços, dias de entrega e demais dados.`;
            newContext = null;
          }
        } catch (e: any) {
          response = `❌ Erro ao criar empresa: ${e.message}`;
          newContext = null;
        }
      } else {
        response = 'Por favor responda à pergunta anterior ou digite **"cancelar"** para desistir.';
        newContext = sessionContext;
      }
    }

    // ── Task creation multi-turn ─────────────────────────────────────
    if (sessionContext?.action === 'create_task') {
      const step = sessionContext.step;
      const data = sessionContext.data || {};

      if (msg === 'cancelar' || msg === 'cancela' || msg === 'não' || msg === 'nao') {
        intent = 'cancel';
        response = '❌ Criação de tarefa cancelada.';
        newContext = null;
      } else if (step === 'title') {
        data.title = message.trim();
        newContext = { action: 'create_task', step: 'description', data };
        intent = 'create_task';
        response = `✅ Título: **${data.title}**\n\nDescreva a tarefa (ou "pular"):`;
      } else if (step === 'description') {
        data.description = msg === 'pular' ? '' : message.trim();
        newContext = { action: 'create_task', step: 'priority', data };
        intent = 'create_task';
        response = `✅ Descrição salva.\n\nQual a **prioridade**?\n• alta\n• media\n• baixa`;
      } else if (step === 'priority') {
        const priorityMap: Record<string, string> = { alta: 'high', alto: 'high', media: 'medium', médio: 'medium', baixa: 'low', baixo: 'low' };
        data.priority = priorityMap[msg] || 'medium';
        newContext = { action: 'create_task', step: 'confirm', data };
        intent = 'create_task';
        response = `📋 **Resumo da tarefa:**\n\n• Título: ${data.title}\n• Descrição: ${data.description || '—'}\n• Prioridade: ${data.priority}\n\nDigite **"confirmar"** para criar ou **"cancelar"** para desistir.`;
      } else if (step === 'confirm' && (msg === 'confirmar' || msg === 'sim' || msg === 'ok')) {
        try {
          const newTask = await storage.createTask({
            title: data.title,
            description: data.description || '',
            priority: data.priority || 'medium',
            assignedToId: user?.id,
            assignedToName: user?.name,
            createdById: user?.id,
            createdByName: user?.name,
          });
          actionExecuted = 'create_task';
          actionData = { taskId: newTask.id, title: data.title };
          intent = 'create_task_done';
          response = `✅ **Tarefa criada com sucesso!**\n\n• Título: ${data.title}\n• Prioridade: ${data.priority}\n\nAcesse **Menu → Tarefas** para visualizar e gerenciar.`;
          newContext = null;
          // Fire push for task created by Clara
          fireNotification('clara_task', { task: data.title }, { url: '/admin/tasks', companyId: user?.empresaId ?? undefined });
        } catch (e: any) {
          response = `❌ Erro ao criar tarefa: ${e.message}`;
          newContext = null;
        }
      } else {
        response = 'Por favor responda à pergunta anterior ou digite **"cancelar"** para desistir.';
        newContext = sessionContext;
      }
    }

    // ── Single-turn intents ─────────────────────────────────────────
    // Check Clara training data first
    else if (await (async () => {
      try {
        const trainings = await storage.getClaraTrainings();
        const active = trainings.filter((t: any) => t.active);
        for (const t of active) {
          const q = t.question.toLowerCase().trim();
          const words = q.split(/\s+/).filter((w: string) => w.length > 3);
          const matches = words.filter((w: string) => msg.includes(w));
          if (matches.length >= Math.min(2, Math.ceil(words.length * 0.5))) {
            intent = 'trained_response';
            response = t.answer;
            return true;
          }
        }
      } catch { /* ignore */ }
      return false;
    })()) { /* response already set above */ }

    else if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|oi tudo|tudo bem|olá clara|clara)/.test(msg)) {
      intent = 'greeting';
      const name = user?.name?.split(' ')[0] || company?.companyName?.split(' ')[0] || '';
      response = `Olá${name ? `, ${name}` : ''}! 👋 Sou a **Clara**, assistente inteligente da VivaFrutaz.\n\nPosso ajudar com:\n• 📦 Pedidos e entregas\n• 🏢 Empresas e cadastros\n• 📊 Estoque e produtos\n• 🚚 Logística e rotas\n• 🛒 Planejamento de compras\n• 🌤️ Clima para entregas\n• ✅ Criar tarefas e cadastros`;
    }

    else if (/clima|tempo|previsão do tempo|previsao do tempo|chuva|temperatura|vai chover|como está o tempo/.test(msg)) {
      intent = 'weather';
      try {
        // Extract city — stop before trailing temporal words so "clima em SP hoje" → "SP"
        const cityRaw = msg
          .match(/em\s+([a-záàâãéèêíïóôõöúçñü\s]+?)(?:\s+(?:hoje|amanhã|amanha|agora|semana|nessa|nesta|essa|esta|para|no|na|do|da)|\s*$)/i)?.[1]?.trim()
          || msg.match(/em\s+([a-záàâãéèêíïóôõöúçñü\s]+)/i)?.[1]?.trim()
          || 'São Paulo';

        // ── Step 1: Geocode city → lat/lon (Open-Meteo geocoding, free, no key) ──
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityRaw)}&count=1&language=pt&format=json`,
          { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'VivaFrutaz/1.0' } },
        );

        if (!geoRes.ok) throw new Error(`Geocoding HTTP ${geoRes.status}`);
        const geoData = await geoRes.json() as any;
        const location = geoData?.results?.[0];

        if (!location) {
          response = `⚠️ Cidade **"${cityRaw}"** não encontrada. Tente com outro nome (ex: "São Paulo", "Rio de Janeiro").`;
        } else {
          const { latitude, longitude, name: cityName, country } = location;

          // ── Step 2: Fetch current weather (Open-Meteo, free, no key) ──────────
          const weatherRes = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
            `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weathercode,windspeed_10m` +
            `&timezone=auto&forecast_days=1`,
            { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'VivaFrutaz/1.0' } },
          );

          if (!weatherRes.ok) throw new Error(`Weather HTTP ${weatherRes.status}`);
          const weatherData = await weatherRes.json() as any;
          const cur = weatherData?.current;

          // WMO weather code → Portuguese description + emoji
          const WMO_CODES: Record<number, [string, string]> = {
            0:  ['Céu limpo', '☀️'],
            1:  ['Principalmente limpo', '🌤️'],
            2:  ['Parcialmente nublado', '⛅'],
            3:  ['Nublado', '☁️'],
            45: ['Névoa', '🌫️'],
            48: ['Névoa com geada', '🌫️'],
            51: ['Garoa leve', '🌦️'],
            53: ['Garoa moderada', '🌦️'],
            55: ['Garoa intensa', '🌦️'],
            61: ['Chuva leve', '🌧️'],
            63: ['Chuva moderada', '🌧️'],
            65: ['Chuva forte', '🌧️'],
            71: ['Neve leve', '🌨️'],
            73: ['Neve moderada', '🌨️'],
            75: ['Neve forte', '🌨️'],
            77: ['Grãos de neve', '🌨️'],
            80: ['Chuva rápida leve', '🌦️'],
            81: ['Chuva rápida moderada', '🌦️'],
            82: ['Chuva rápida forte', '⛈️'],
            85: ['Neve rápida leve', '🌨️'],
            86: ['Neve rápida forte', '🌨️'],
            95: ['Tempestade', '⛈️'],
            96: ['Tempestade com granizo', '⛈️'],
            99: ['Tempestade forte com granizo', '⛈️'],
          };

          const code = cur?.weathercode ?? 0;
          const [descricao, emoji] = WMO_CODES[code] ?? ['Condição desconhecida', '🌡️'];
          const temperatura = Math.round(cur?.temperature_2m ?? 0);
          const sensacao = Math.round(cur?.apparent_temperature ?? temperatura);
          const umidade = cur?.relative_humidity_2m ?? 0;
          const vento = Math.round(cur?.windspeed_10m ?? 0);
          const atualizadoEm = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

          // Structured weather object (matches spec: {cidade, temperatura, descricao, atualizadoEm})
          const weatherPayload = { cidade: `${cityName}, ${country}`, temperatura, descricao, atualizadoEm };
          actionData = weatherPayload;

          response = `${emoji} **Clima em ${cityName}${country ? `, ${country}` : ''}**\n\n` +
            `• 🌡️ Temperatura: **${temperatura}°C** (sensação ${sensacao}°C)\n` +
            `• ${emoji} Condição: **${descricao}**\n` +
            `• 💧 Umidade: **${umidade}%**\n` +
            `• 💨 Vento: **${vento} km/h**\n\n` +
            `_Atualizado em: ${atualizadoEm} — Open-Meteo (tempo real)_`;
        }
      } catch (err: any) {
        console.error('[CLARA_WEATHER] Erro ao buscar clima:', err?.message ?? err);
        response = '⚠️ Serviço de clima temporariamente indisponível. Tente novamente em instantes.';
      }
    }

    else if (isInternal && /criar empresa|adicionar empresa|nova empresa|cadastrar empresa/.test(msg)) {
      if (!isAdmin) {
        intent = 'permission_denied';
        response = '⚠️ Apenas Administradores e Diretores podem criar empresas pelo assistente.';
      } else {
        intent = 'create_company';
        newContext = { action: 'create_company', step: 'name', data: {} };
        response = '🏢 **Criar Nova Empresa**\n\nVou te guiar pelo cadastro. Digite **"cancelar"** a qualquer momento para desistir.\n\nPrimeiro, informe o **nome da empresa**:';
      }
    }

    else if (isInternal && /pedido|pedidos/.test(msg)) {
      intent = 'query_orders';
      try {
        const allOrders = await safeGetOrders();
        const today = new Date().toISOString().split('T')[0];
        const todayOrders = allOrders.filter((o: any) => o.deliveryDate?.toString().startsWith(today) || o.orderDate?.toString().startsWith(today));
        const pending = allOrders.filter((o: any) => o.status === 'PENDING' || o.status === 'ACTIVE');
        const confirmed = allOrders.filter((o: any) => o.status === 'CONFIRMED');
        const cancelled = allOrders.filter((o: any) => o.status === 'CANCELLED');

        if (/hoje|movimento hoje|resumo de hoje/.test(msg)) {
          response = `📦 **Pedidos de Hoje (${today})**\n\n• Entrega hoje: ${todayOrders.length}\n• Pendentes/Ativos: ${pending.length}\n• Confirmados: ${confirmed.length}\n• Cancelados: ${cancelled.length}\n• Total no sistema: ${allOrders.length}`;
        } else if (/pendente|pendentes/.test(msg)) {
          if (pending.length === 0) {
            response = '✅ Nenhum pedido pendente no momento.';
          } else {
            const lines = pending.slice(0, 10).map((o: any) => `• ${o.orderCode || `#${o.id}`} — ${o.status}`).join('\n');
            response = `⏳ **Pedidos Pendentes (${pending.length} total)**\n\n${lines}${pending.length > 10 ? `\n\n...e mais ${pending.length - 10} pedidos. Acesse o painel de pedidos para ver todos.` : ''}`;
          }
        } else if (/quantos|total|quantidade/.test(msg)) {
          response = `📊 **Total de Pedidos no Sistema**\n\n• Total: ${allOrders.length}\n• Confirmados: ${confirmed.length}\n• Pendentes/Ativos: ${pending.length}\n• Cancelados: ${cancelled.length}`;
        } else {
          response = `📦 **Resumo de Pedidos**\n\n• Total: ${allOrders.length}\n• Confirmados: ${confirmed.length}\n• Pendentes: ${pending.length}\n• Cancelados: ${cancelled.length}\n\nPara detalhes específicos, pergunte: "pedidos hoje", "pedidos pendentes", "quantos pedidos".`;
        }
      } catch { response = '⚠️ Não foi possível consultar os pedidos agora.'; }
    }

    else if (isInternal && /empresa|empresas/.test(msg)) {
      intent = 'query_companies';
      try {
        const allCompanies = await storage.getCompanies();
        const active = allCompanies.filter((c: any) => c.active);
        const inactive = allCompanies.filter((c: any) => !c.active);

        if (/não pediram|nao pediram|sem pedido|não fizeram pedido|nao fizeram/.test(msg)) {
          const allOrders = await safeGetOrders();
          const activeWindow = await storage.getActiveOrderWindow();
          const weekRef = activeWindow?.weekReference;
          const companiesWithOrders = new Set(
            allOrders
              .filter((o: any) => weekRef ? o.weekReference === weekRef : true)
              .filter((o: any) => o.status !== 'CANCELLED')
              .map((o: any) => o.companyId)
          );
          const noPedido = active.filter((c: any) => !companiesWithOrders.has(c.id));
          if (noPedido.length === 0) {
            response = `✅ Todas as empresas ativas já fizeram pedido${weekRef ? ` na ${weekRef}` : ''}.`;
          } else {
            const lines = noPedido.slice(0, 15).map((c: any) => `• ${c.companyName}`).join('\n');
            response = `⚠️ **Empresas sem pedido${weekRef ? ` (${weekRef})` : ''}:** ${noPedido.length}\n\n${lines}${noPedido.length > 15 ? `\n\n...e mais ${noPedido.length - 15}` : ''}`;
          }
        } else if (/inativa|inativas/.test(msg)) {
          if (inactive.length === 0) {
            response = '✅ Nenhuma empresa inativa.';
          } else {
            const lines = inactive.slice(0, 10).map((c: any) => `• ${c.companyName}`).join('\n');
            response = `🔴 **Empresas Inativas (${inactive.length})**\n\n${lines}`;
          }
        } else {
          response = `🏢 **Empresas no Sistema**\n\n• Total: ${allCompanies.length}\n• Ativas: ${active.length}\n• Inativas: ${inactive.length}\n\nDicas:\n• "Empresas que não fizeram pedido"\n• "Empresas inativas"\n• "Criar empresa"`;
        }
      } catch { response = '⚠️ Não foi possível consultar as empresas agora.'; }
    }

    else if (isInternal && /estoque|inventário|inventario|produto|produtos/.test(msg)) {
      intent = 'query_stock';
      try {
        const prods = await storage.getProducts();
        const active = prods.filter((p: any) => p.active !== false);
        const inventorySettings = await storage.getInventorySettings();

        if (/baixo|crítico|critico|faltando|pouco|mínimo|minimo/.test(msg)) {
          const lowStock = inventorySettings.filter((s: any) => {
            const current = parseFloat(s.currentStock || '0');
            const min = parseFloat(s.minStock || '0');
            return min > 0 && current <= min;
          });
          if (lowStock.length === 0) {
            response = `✅ **Estoque OK** — Nenhum produto com estoque crítico no momento.`;
          } else {
            const lines = lowStock.slice(0, 10).map((s: any) => `• **${s.productName}**: ${s.currentStock} ${s.unit || 'un'} (mínimo: ${s.minStock})`).join('\n');
            response = `⚠️ **Estoque Crítico (${lowStock.length} produto(s))**\n\n${lines}${lowStock.length > 10 ? `\n\n...e mais ${lowStock.length - 10}` : ''}\n\nAcesse **Menu → Estoque** para detalhes.`;
          }
        } else {
          const tracked = inventorySettings.length;
          response = `📦 **Estoque VivaFrutaz**\n\n• Produtos cadastrados: **${prods.length}**\n• Produtos ativos: **${active.length}**\n• Produtos com controle de estoque: **${tracked}**\n\nDicas:\n• "Clara, produtos com estoque baixo"\n• "Clara, lista de compras"\n\nAcesse **Menu → Estoque** para painel completo.`;
        }
      } catch { response = '⚠️ Não foi possível consultar o estoque agora.'; }
    }

    else if (isInternal && /compra|compras|lista de compras|plano de compras|planejamento|o que comprar|precisa comprar/.test(msg)) {
      intent = 'query_purchases';
      try {
        const allOrders = await safeGetOrders();
        const activeWindow = await storage.getActiveOrderWindow();
        const weekRef = activeWindow?.weekReference;
        const weekOrders = weekRef ? allOrders.filter((o: any) => o.weekReference === weekRef && o.status !== 'CANCELLED') : [];
        const prods = await storage.getProducts();
        const inventorySettings = await storage.getInventorySettings();

        if (weekOrders.length === 0) {
          response = `🛒 **Planejamento de Compras**\n\n${weekRef ? `Semana: ${weekRef}\n` : ''}Nenhum pedido ativo para a semana atual.\n\nAcesse **Menu → Planejamento de Compras** para gerar a lista completa.`;
        } else {
          const lowStock = inventorySettings.filter((s: any) => parseFloat(s.currentStock || '0') <= parseFloat(s.minStock || '0'));
          response = `🛒 **Planejamento de Compras**\n\n${weekRef ? `📅 Semana: **${weekRef}**` : ''}\n• Pedidos ativos: **${weekOrders.length}**\n• Produtos com estoque baixo: **${lowStock.length}**\n\n${lowStock.length > 0 ? `⚠️ Reposição urgente:\n${lowStock.slice(0, 5).map((s: any) => `• ${s.productName}: ${s.currentStock} (mín: ${s.minStock})`).join('\n')}\n\n` : ''}Acesse **Menu → Planejamento de Compras** para a lista completa com quantidades.`;
        }
      } catch { response = '🛒 Acesse **Menu → Planejamento de Compras** para ver a lista detalhada.'; }
    }

    else if (isInternal && /criar tarefa|nova tarefa|adicionar tarefa|agendar tarefa/.test(msg)) {
      intent = 'create_task';
      newContext = { action: 'create_task', step: 'title', data: {} };
      response = `✅ **Criar Nova Tarefa**\n\nVou te guiar. Digite **"cancelar"** a qualquer momento.\n\nQual é o **título** da tarefa?`;
    }

    else if (isInternal && /rota|rotas|logística|logistica|entrega|entregas|janela de entrega|janelas|horário de entrega/.test(msg)) {
      intent = 'query_routes';
      try {
        const routes = await safeGetRoutes();
        const activeWindow = await storage.getActiveOrderWindow();
        let routeLines = '';
        if (routes.length > 0) {
          routeLines = routes.slice(0, 8).map((r: any) => `• **${r.name}** — ${r.status || 'Ativa'}${r.driverName ? ` — Motorista: ${r.driverName}` : ''}`).join('\n');
        }

        // Check if asking about a specific company's delivery window
        const companyMatch = message.match(/(?:empresa|cliente|para)\s+([A-Za-záàâãéèêíïóôõöúçñü\s]+)/i);
        if (companyMatch && companyMatch[1]) {
          const searchName = companyMatch[1].trim().toLowerCase();
          const allCompanies = await storage.getCompanies();
          const found = allCompanies.find((c: any) => c.companyName?.toLowerCase().includes(searchName));
          if (found) {
            let deliveryInfo = `🚚 **Logística — ${found.companyName}**\n\n`;
            if (found.deliveryConfigJson) {
              try {
                const cfg = typeof found.deliveryConfigJson === 'string' ? JSON.parse(found.deliveryConfigJson) : found.deliveryConfigJson;
                const days = Object.entries(cfg).filter(([, v]: any) => v?.enabled).map(([day, v]: any) => `• ${day}: ${v.startTime} às ${v.endTime}`).join('\n');
                deliveryInfo += days.length > 0 ? `Janelas de entrega:\n${days}` : 'Nenhuma janela configurada.';
              } catch { deliveryInfo += 'Configuração não disponível.'; }
            } else {
              deliveryInfo += found.deliveryTime ? `Horário padrão: **${found.deliveryTime}**` : 'Nenhuma janela de entrega configurada para esta empresa.';
            }
            if ((found.allowedOrderDays as any)?.length > 0) {
              deliveryInfo += `\n\nDias de pedido: ${(found.allowedOrderDays as any[]).join(', ')}`;
            }
            response = deliveryInfo;
          } else {
            response = `⚠️ Empresa "**${companyMatch[1]!.trim()}**" não encontrada. Verifique o nome e tente novamente.`;
          }
        } else {
          response = `🚚 **Logística e Rotas**\n\n• Rotas cadastradas: **${routes.length}**\n${routeLines ? `\n${routeLines}\n` : ''}\n${activeWindow ? `📅 Janela ativa: **${activeWindow.weekReference}** — entrega de ${new Date(activeWindow.deliveryStartDate).toLocaleDateString('pt-BR')} a ${new Date(activeWindow.deliveryEndDate).toLocaleDateString('pt-BR')}` : '⚠️ Nenhuma janela de entrega ativa'}\n\nDica: "Clara, qual o horário de entrega da empresa [Nome]?"`;
        }
      } catch { response = '🚚 Acesse **Menu → Logística** para ver rotas, motoristas e veículos.'; }
    }

    else if (isInternal && /sistema|auditoria|saúde|saude|erros|alertas|status do sistema/.test(msg)) {
      intent = 'system_status';
      try {
        const allOrders = await safeGetOrders();
        const confirmed = allOrders.filter((o: any) => o.status === 'CONFIRMED').length;
        const pending = allOrders.filter((o: any) => o.status === 'PENDING' || o.status === 'ACTIVE').length;
        response = `🔧 **Status do Sistema**\n\n• Pedidos confirmados: ${confirmed}\n• Pedidos pendentes: ${pending}\n• Total de pedidos: ${allOrders.length}\n\nPara auditoria completa → Menu → Área do Desenvolvedor → Auditoria\nPara alertas preditivos → Menu → IA Operacional`;
      } catch { response = '🔧 Para auditoria completa acesse → Menu → Área do Desenvolvedor → Auditoria.'; }
    }

    else if (!isInternal && company) {
      // Client-specific queries
      if (/pedido|meu pedido|meus pedidos|status/.test(msg)) {
        intent = 'client_orders';
        try {
          const compOrders = await storage.getCompanyOrders(company.id);
          const recent = compOrders.slice(0, 5);
          if (recent.length === 0) {
            response = '📦 Você ainda não tem pedidos registrados. Acesse "Novo Pedido" para fazer seu primeiro pedido.';
          } else {
            const statusMap: Record<string, string> = {
              CONFIRMED: '✅ Confirmado', ACTIVE: '🟡 Em andamento', CANCELLED: '❌ Cancelado',
              PENDING: '⏳ Pendente', OPEN_FOR_EDITING: '✏️ Em edição', REOPEN_REQUESTED: '🔄 Solicitando reabertura'
            };
            const lines = recent.map((o: any) => `• ${o.orderCode || `#${o.id}`} — ${statusMap[o.status] || o.status} — Entrega: ${o.deliveryDate?.toString().split('T')[0] || '—'}`).join('\n');
            response = `📦 **Seus Pedidos Recentes**\n\n${lines}\n\nPara ver o histórico completo acesse "Histórico de Pedidos" no menu.`;
          }
        } catch { response = '⚠️ Não foi possível consultar seus pedidos agora.'; }
      } else if (/entrega|quando chega|previsão|previsao/.test(msg)) {
        intent = 'client_delivery';
        try {
          const win = await storage.getActiveOrderWindow();
          if (win) {
            response = `📅 **Janela de Pedidos Ativa**\n\n• Semana: ${win.weekReference}\n• Pedidos até: ${new Date(win.orderCloseDate).toLocaleDateString('pt-BR')}\n• Entrega: ${new Date(win.deliveryStartDate).toLocaleDateString('pt-BR')} a ${new Date(win.deliveryEndDate).toLocaleDateString('pt-BR')}`;
          } else {
            response = '📅 Não há janela de pedidos aberta no momento. Aguarde a abertura da próxima janela.';
          }
        } catch { response = '⚠️ Não foi possível consultar a janela de entrega agora.'; }
      } else {
        intent = 'client_general';
        response = `Olá! Posso ajudar com:\n• **"meus pedidos"** — ver status dos pedidos\n• **"previsão de entrega"** — ver datas da janela atual\n• **"clima"** — previsão do tempo\n• **"suporte"** — contato com a equipe\n\nOu fale diretamente com nossa equipe pelo WhatsApp! 📱`;
      }
    }

    else if (isInternal && /exportar|gerar relatório|gerar relatorio|relatório financeiro|relatorio financeiro|relatório de pedidos|relatorio de pedidos|download/.test(msg)) {
      intent = 'export';
      // Parse type
      const isFinancial = /faturamento|financeiro|financeira|fiscal|nota/.test(msg);
      const isPurchase = /compras|purchase|fornecedor/.test(msg);
      const type = isFinancial ? 'financial' : isPurchase ? 'orders' : 'orders';

      // Parse period
      let period = 'week';
      let periodLabel = 'esta semana';
      if (/hoje|today/.test(msg)) { period = 'today'; periodLabel = 'hoje'; }
      else if (/semana/.test(msg)) { period = 'week'; periodLabel = 'desta semana'; }
      else if (/mês passado|mes passado|último mês|ultimo mes/.test(msg)) { period = 'lastmonth'; periodLabel = 'do mês passado'; }
      else if (/mês|mes|mensal/.test(msg)) { period = 'month'; periodLabel = 'deste mês'; }
      else if (/tudo|todos|histórico|historico|completo/.test(msg)) { period = 'all'; periodLabel = 'completo (todos os períodos)'; }

      // Parse company name
      let companyParam = '';
      let companyLabel = '';
      const empresaMatch = msg.match(/(?:da empresa|do cliente|empresa|cliente)\s+([a-záéíóúãõâêôçñ\s]{2,30})(?:\s|$)/i);
      if (empresaMatch && empresaMatch[1]) {
        const searchName = empresaMatch[1].trim().toLowerCase();
        const allCompanies = await storage.getCompanies();
        const found = allCompanies.find((c: any) =>
          c.companyName.toLowerCase().includes(searchName) ||
          searchName.includes(c.companyName.toLowerCase().substring(0, 4))
        );
        if (found) {
          companyParam = `&companyId=${found.id}`;
          companyLabel = ` da empresa **${(found as any).companyName}**`;
        }
      }

      // Parse status
      let statusParam = '';
      if (/pendente/.test(msg)) statusParam = '&status=PENDING';
      else if (/confirmado/.test(msg)) statusParam = '&status=CONFIRMED';
      else if (/ativo|ativa/.test(msg)) statusParam = '&status=ACTIVE';

      // Count orders for this period
      try {
        const allOrders = await safeGetOrders();
        const now = new Date();
        let dateFrom: Date | null = null;
        if (period === 'today') dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        else if (period === 'week') { const diff = now.getDay() === 0 ? -6 : 1 - now.getDay(); dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff); }
        else if (period === 'month') dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        else if (period === 'lastmonth') dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);

        let filtered = allOrders;
        if (dateFrom) filtered = filtered.filter((o: any) => new Date(o.orderDate || o.createdAt) >= dateFrom!);
        if (companyParam) {
          const cid = parseInt(companyParam.split('=')[1] ?? '');
          filtered = filtered.filter((o: any) => o.companyId === cid);
        }
        if (statusParam) {
          const st = statusParam.split('=')[1];
          filtered = filtered.filter((o: any) => o.status === st);
        }
        if (isFinancial) filtered = filtered.filter((o: any) => o.status !== 'CANCELLED');

        const count = filtered.length;
        const total = filtered.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
        const typeLabel = isFinancial ? 'financeiro' : 'de pedidos';

        const downloadUrl = `/api/clara/export?type=${type}&period=${period}${companyParam}${statusParam}`;
        response = `📊 **Relatório ${typeLabel} ${periodLabel}${companyLabel}**\n\nEncontrei **${count} ${isFinancial ? 'pedido(s) faturável(is)' : 'pedido(s)'}**${total > 0 ? ` · Total: **R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**` : ''}.\n\n✅ Clique no botão abaixo para baixar o arquivo Excel.`;
        newContext = { action: 'export_ready', data: { downloadUrl, count, type: typeLabel, period: periodLabel } };
      } catch {
        response = `📊 Preparando exportação de relatório ${isFinancial ? 'financeiro' : 'de pedidos'} ${periodLabel}${companyLabel}.\n\n✅ Clique no botão abaixo para baixar.`;
        newContext = { action: 'export_ready', data: { downloadUrl: `/api/clara/export?type=${type}&period=${period}${companyParam}${statusParam}` } };
      }
    }

    else if (isInternal && /analisar clientes|clientes em risco|clientes inativos|clientes parado|cliente inativo|clientes sem pedido há/.test(msg)) {
      intent = 'commercial_risk';
      try {
        const now = Date.now();
        const allOrders = await safeGetOrders();
        const allCompanies = await storage.getCompanies();
        const activeCompanies = allCompanies.filter((c: any) => c.active);
        const ordersByCompany: Record<number, any[]> = {};
        for (const o of allOrders.filter((o: any) => o.status !== 'CANCELLED')) {
          if (!ordersByCompany[o.companyId]) ordersByCompany[o.companyId] = [];
          ordersByCompany[o.companyId]!.push(o);
        }
        const atRisk = activeCompanies.filter((c: any) => {
          const orders = ordersByCompany[c.id] || [];
          if (orders.length === 0) return false;
          const lastOrder = orders.reduce((a: any, b: any) => new Date(b.orderDate || b.createdAt) > new Date(a.orderDate || a.createdAt) ? b : a);
          const days = Math.floor((now - new Date(lastOrder.orderDate || lastOrder.createdAt).getTime()) / 86400000);
          return days >= 14;
        }).map((c: any) => {
          const orders = ordersByCompany[c.id] || [];
          const last = orders.reduce((a: any, b: any) => new Date(b.orderDate || b.createdAt) > new Date(a.orderDate || a.createdAt) ? b : a);
          const days = Math.floor((now - new Date(last.orderDate || last.createdAt).getTime()) / 86400000);
          return { name: c.companyName, days };
        }).sort((a, b) => b.days - a.days).slice(0, 8);

        if (atRisk.length === 0) {
          response = `✅ **Clientes em Risco**\n\nNenhum cliente inativo detectado nos últimos 14 dias. Todos os clientes ativos compraram recentemente! 🎉`;
        } else {
          const lines = atRisk.map(c => `• **${c.name}** — ${c.days} dias sem pedido`).join('\n');
          response = `🔴 **Clientes em Risco (${atRisk.length})**\n\n${lines}\n\nAcesse **Menu → Inteligência Comercial** para análise completa e sugestões de ação.`;
        }
      } catch { response = '⚠️ Não foi possível analisar os clientes agora. Acesse **Menu → Inteligência Comercial**.'; }
    }

    else if (isInternal && /oportunidade|oportunidades de venda|produtos parado|produtos que pararam|produto não pedido|venda cruzada/.test(msg)) {
      intent = 'commercial_opportunities';
      response = `💡 **Oportunidades de Venda**\n\nAcesse **Menu → Inteligência Comercial** para ver:\n\n• Produtos que clientes pararam de pedir\n• Clientes com queda de volume\n• Sugestões de reposição\n\nO painel atualiza automaticamente com base no histórico de compras.`;
    }

    else if (isInternal && /prever faturamento|faturamento previsto|previsão de faturamento|previsao de faturamento|forecast|faturamento do mes/.test(msg)) {
      intent = 'financial_forecast';
      try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const allOrders = await safeGetOrders();
        const validOrders = allOrders.filter((o: any) => o.status !== 'CANCELLED');
        const thisMonthOrders = validOrders.filter((o: any) => new Date(o.orderDate || o.createdAt) >= startOfMonth);
        const thisMonthRevenue = thisMonthOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
        // Last 3 months avg
        const last3 = [1, 2, 3].map(i => {
          const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
          return validOrders.filter((o: any) => { const d = new Date(o.orderDate || o.createdAt); return d >= mStart && d <= mEnd; })
            .reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
        });
        const avg3 = last3.reduce((a, b) => a + b, 0) / 3;
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const forecast = thisMonthRevenue + (avg3 / daysInMonth) * (daysInMonth - now.getDate());
        const growthPct = avg3 > 0 ? ((forecast - avg3) / avg3) * 100 : 0;

        response = `💰 **Previsão de Faturamento**\n\n📅 Mês atual: **R$ ${thisMonthRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}** (até hoje)\n📈 Previsão: **R$ ${forecast.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**\n📊 Média últimos 3 meses: R$ ${avg3.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n${growthPct > 0 ? `🟢 Tendência: +${growthPct.toFixed(1)}%` : `🔴 Tendência: ${growthPct.toFixed(1)}%`}\n\nAcesse **Menu → Inteligência Financeira** para análise completa.`;
      } catch { response = '💰 Acesse **Menu → Inteligência Financeira** para ver previsão de faturamento e análises detalhadas.'; }
    }

    else if (isInternal && /faturamento por cliente|ranking de cliente|clientes mais rentáveis|clientes mais rentaveis|top clientes/.test(msg)) {
      intent = 'financial_ranking';
      try {
        const allOrders = await safeGetOrders();
        const allCompanies = await storage.getCompanies();
        const validOrders = allOrders.filter((o: any) => o.status !== 'CANCELLED');
        const byCompany: Record<number, { name: string; total: number }> = {};
        for (const o of validOrders) {
          if (!byCompany[o.companyId]) {
            const c = allCompanies.find((c: any) => c.id === o.companyId);
            byCompany[o.companyId] = { name: c?.companyName || `#${o.companyId}`, total: 0 };
          }
          byCompany[o.companyId]!.total += parseFloat(o.totalValue || '0');
        }
        const top = Object.values(byCompany).sort((a, b) => b.total - a.total).slice(0, 8);
        const lines = top.map((c, i) => `${i + 1}. **${c.name}** — R$ ${c.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`).join('\n');
        response = `🏆 **Top Clientes por Faturamento**\n\n${lines}\n\nAcesse **Menu → Inteligência Financeira** para histórico mensal e análise completa.`;
      } catch { response = '🏆 Acesse **Menu → Inteligência Financeira** para ver o ranking de clientes.'; }
    }

    else if (isInternal && /analisar logística|analisar logistica|agenda de entrega|quantas entrega|capacidade de entrega|rotas disponíveis|rotas disponiveis|logística de amanhã|logistica de amanha/.test(msg)) {
      intent = 'logistics_analysis';
      try {
        const allOrders = await safeGetOrders();
        const routes = await safeGetRoutes();
        const activeWindow = await storage.getActiveOrderWindow();
        const activeOrders = allOrders.filter((o: any) => !['CANCELLED'].includes(o.status));
        const withDelivery = activeOrders.filter((o: any) => o.deliveryDate);

        // Group by delivery date
        const byDay: Record<string, number> = {};
        for (const o of withDelivery) {
          const d = new Date(o.deliveryDate).toLocaleDateString('pt-BR');
          byDay[d] = (byDay[d] || 0) + 1;
        }
        const sortedDays = Object.entries(byDay).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const dayLines = sortedDays.map(([d, c]) => `• ${d}: ${c} entrega(s)${c >= 5 ? ' ⚠️ sobrecarga' : ''}`).join('\n');

        response = `🚚 **Análise Logística**\n\n• Rotas cadastradas: **${routes.length}**\n• Entregas agendadas: **${activeOrders.length}**\n• Semana atual: ${activeWindow?.weekReference || '—'}\n\n📅 Distribuição de entregas:\n${dayLines || '— Sem entregas agendadas'}\n\n${routes.filter((r: any) => !r.vehicleId || !r.driverId).length > 0 ? `⚠️ ${routes.filter((r: any) => !r.vehicleId || !r.driverId).length} rota(s) sem motorista ou veículo.\n\n` : ''}Acesse **Menu → Inteligência Logística** para análise completa.`;
      } catch { response = '🚚 Acesse **Menu → Logística** para ver rotas, motoristas e agenda de entregas.'; }
    }

    else if (isInternal && /analisar eficiência|eficiencia do sistema|analisar sistema|auto otimização|auto otimizacao|gargalo|processos lentos/.test(msg)) {
      intent = 'system_efficiency';
      try {
        const allOrders = await safeGetOrders();
        const now = Date.now();
        const recent = allOrders.filter((o: any) => now - new Date(o.orderDate || o.createdAt).getTime() < 7 * 86400000);
        const pending = recent.filter((o: any) => ['PENDING', 'ACTIVE'].includes(o.status));
        const confirmed = recent.filter((o: any) => o.status === 'CONFIRMED');
        const cancelled = recent.filter((o: any) => o.status === 'CANCELLED');
        const cancellationRate = recent.length > 0 ? ((cancelled.length / recent.length) * 100).toFixed(1) : '0';

        response = `⚙️ **Eficiência Operacional (últimos 7 dias)**\n\n• Pedidos recebidos: **${recent.length}**\n• Confirmados: **${confirmed.length}**\n• Pendentes: **${pending.length}**\n• Cancelados: **${cancelled.length}** (${cancellationRate}%)\n\n${parseFloat(cancellationRate) > 15 ? '⚠️ Taxa de cancelamento elevada. Revisar processo de aprovação.' : '✅ Taxa de cancelamento dentro do esperado.'}\n${pending.length > 5 ? `⚠️ ${pending.length} pedido(s) pendente(s) de aprovação.` : ''}\n\nAcesse **Menu → IA Operacional** para alertas automáticos e análise completa.`;
      } catch { response = '⚙️ Acesse **Menu → IA Operacional** para análise de eficiência do sistema.'; }
    }

    // ── Knowledge base: new features explanations ────────────────────────────
    else if (/como funciona o escopo contratual|escopo contratual\?|o que é o escopo contratual|explica (o )?escopo/.test(msg)) {
      intent = 'explain_scope';
      if (isInternal) {
        response = `📋 **Escopo Contratual**\n\nO escopo contratual define os produtos, quantidades e dias de entrega fixos para clientes do tipo **Contratual**.\n\n**Como funciona:**\n1. Acesse **Menu → Gestão de Contratos** e selecione o cliente\n2. Na aba **Escopo Contratual**, adicione itens: produto, quantidade, dia da semana e preço unitário\n3. Clique em **Gerar Pedidos da Semana** para criar os pedidos automaticamente\n\n**Benefícios:**\n• Pedidos gerados automaticamente toda semana\n• Aparece no Planejamento de Compras consolidado\n• O cliente pode visualizar seu escopo pelo portal\n\n💡 Use **Simulação Comercial** para testar um escopo antes de formalizar.`;
      } else {
        response = `📋 **Seu Escopo Contratual**\n\nO escopo contratual define os produtos e quantidades que você recebe em cada dia da semana, conforme seu contrato com a VivaFrutaz.\n\nPara ver seu escopo atual, acesse **Menu → Meu Escopo Contratual** ou pergunte: _"Quais frutas recebo?"_\n\nPara solicitar alterações, diga: _"Quero alterar meu escopo"_`;
      }
    }

    else if (/como (gerar|criar|emitir) (uma )?nota fiscal|nota fiscal\?|o que é danfe|como funciona (a )?gestão de notas|notas fiscais\?/.test(msg)) {
      intent = 'explain_fiscal';
      response = isInternal
        ? `🧾 **Gestão de Notas Fiscais**\n\nA área de Notas Fiscais (**Menu → Gestão de Notas Fiscais**) centraliza:\n\n**Emissão de DANFE:**\n• Acesse um pedido → clique em **Gerar DANFE** para pré-visualizar e baixar o PDF\n• Preencha nº da nota, série, chave de acesso e valor\n\n**Exportação para Bling:**\n• Em cada pedido faturado, clique em **Exportar para Bling** para enviar ao ERP\n• O sistema registra o status da exportação (Pendente / Exportado)\n\n**Importação de Notas de Entrada (OCR):**\n• Acesse **Menu → Compras → Notas Fiscais de Entrada**\n• Faça upload do PDF do DANFE — o sistema lê automaticamente via OCR\n• Os itens são adicionados ao inventário com cálculo de custo médio\n\n💡 Dica: o status fiscal de cada pedido fica visível na coluna "Fiscal" da tabela de pedidos.`
        : `🧾 Informações sobre notas fiscais são gerenciadas pela equipe administrativa. Em caso de dúvidas sobre documentos fiscais, entre em contato com o suporte: _"Como falar com o atendimento?"_`;
    }

    else if (/como (exportar|enviar) (para o )?bling|bling\?|integração com bling|exportação bling/.test(msg)) {
      intent = 'explain_bling';
      response = isInternal
        ? `🔗 **Exportação para o Bling**\n\nO sistema integra com o **Bling ERP** para envio de pedidos faturados.\n\n**Como exportar:**\n1. Acesse **Menu → Gestão de Notas Fiscais**\n2. Selecione pedidos com status **Faturado**\n3. Clique em **Exportar para Bling** no pedido desejado\n4. O sistema envia os dados e registra o status: _Pendente → Exportado_\n\n**Dados enviados:** número da nota, série, chave de acesso, cliente, produtos, valores e impostos.\n\n⚙️ Configure as credenciais do Bling em **Menu → Configurações Fiscais**.`
        : `🔗 A exportação para sistemas de gestão é realizada pela equipe administrativa. Em caso de dúvidas, entre em contato com o suporte.`;
    }

    else if (/como funciona (o )?custo médio|custo médio\?|calcula custo médio|o que é custo médio/.test(msg)) {
      intent = 'explain_avg_cost';
      response = isInternal
        ? `📊 **Cálculo de Custo Médio Ponderado**\n\nO sistema recalcula automaticamente o custo médio de cada produto ao importar uma nota fiscal de entrada.\n\n**Fórmula:**\n\`Novo Custo Médio = (Custo Médio Atual × Estoque Atual + Preço da NF × Quantidade Comprada) ÷ (Estoque Atual + Quantidade Comprada)\`\n\n**Exemplo:**\n• Estoque: 100 kg de Manga a R$ 5,00/kg\n• Compra: 50 kg a R$ 6,50/kg\n• Novo custo médio: **R$ 5,50/kg**\n\n**Onde verificar:** Menu → Estoque / Inventário → coluna "Custo Médio"\n\n💡 O custo médio é utilizado para análise de margem nos contratos e simulações comerciais.`
        : `📊 Informações sobre custos são gerenciadas internamente. Para consultas sobre preços, entre em contato com nossa equipe.`;
    }

    else if (/como funciona (o )?id de produto|id de produto\?|código de produto|produto base|produtos derivados/.test(msg)) {
      intent = 'explain_product_id';
      response = isInternal
        ? `🏷️ **ID de Produto Base**\n\nO **ID de Produto Base** (código único) é utilizado para agrupar produtos relacionados — chamados de **produtos derivados**.\n\n**Exemplo:**\nOs produtos _Manga In Natura_, _Manga Higienizada_ e _Manga Pote BIO_ podem ter o mesmo código **002**, indicando que são derivados do mesmo produto base.\n\n**Como usar:**\n1. Acesse **Menu → Produtos** → Novo Produto ou editar existente\n2. No campo **ID do Produto Base**, insira o código manualmente ou clique em **Gerar Auto**\n3. Produtos com o mesmo código são agrupados nos alertas de variação de preço\n\n**Benefícios:**\n• Alertas de custo impactam todos os derivados simultaneamente\n• Facilita análise de categoria e margem`
        : `🏷️ Informações sobre cadastro de produtos são gerenciadas pela equipe. Em caso de dúvidas, entre em contato com o suporte.`;
    }

    else if (/como funciona (o )?portal do cliente|portal do cliente\?|como o cliente (acessa|vê|visualiza)|o que o cliente pode fazer/.test(msg)) {
      intent = 'explain_client_portal';
      response = isInternal
        ? `🖥️ **Portal do Cliente**\n\nO portal permite que clientes acessem o sistema com login próprio. Cada cliente vê apenas suas informações.\n\n**O que o cliente pode fazer:**\n• Ver seus pedidos e status de entrega\n• Consultar e visualizar seu escopo contratual\n• Ver os produtos disponíveis no catálogo\n• Solicitar alterações de escopo via Clara IA\n• Fazer contato com o suporte\n\n**Tipos de cliente no portal:**\n• **Avulso/Mensal**: visualiza pedidos e catálogo\n• **Contratual**: também acessa escopo contratual com dados de entrega e valor\n\n**Configuração:** O acesso é criado em **Menu → Empresas** → aba **Acesso ao Portal** da empresa.`
        : `🖥️ Você está usando o **Portal do Cliente** da VivaFrutaz. Aqui você pode:\n• Ver seus pedidos e previsão de entrega\n• Consultar seu escopo contratual\n• Solicitar alterações\n\nSe precisar de ajuda, diga: _"Quero falar com o atendimento"_`;
    }

    else if (/como funciona (a )?simulação (comercial|de escopo)|simulação comercial\?|o que é simulação comercial/.test(msg)) {
      intent = 'explain_scope_simulation';
      response = isInternal
        ? `📈 **Simulação de Escopo Comercial**\n\nA **Simulação Comercial** (Menu → Simulação Comercial) permite criar e analisar propostas de escopo antes de formalizar um contrato.\n\n**Como funciona:**\n1. Crie uma nova simulação com nome, empresa-alvo e margem desejada\n2. Na aba **Escopo**, adicione produtos, quantidades e preços\n3. Na aba **Análise**, veja automaticamente: valor semanal, mensal, anual e margem calculada\n4. Quando aprovada, clique em **Converter em Cliente** para criar a empresa e o escopo definitivo\n\n**Ideal para:** equipe comercial precificar propostas e apresentar ao cliente antes do fechamento.`
        : `📈 Informações sobre propostas e contratos são tratadas pela equipe comercial. Entre em contato conosco para mais informações.`;
    }

    else if (!isInternal && /como falar|contato|atendimento|suporte|falar com (alguém|equipe|vocês)/.test(msg)) {
      intent = 'client_support';
      try {
        const supportConfig = await storage.getSetting('support_config');
        const config = supportConfig ? JSON.parse(supportConfig) : null;
        const whatsapp = config?.whatsapp || null;
        const email = config?.email || null;
        let contactLine = '';
        if (whatsapp) contactLine += `• WhatsApp: **${whatsapp}**\n`;
        if (email) contactLine += `• E-mail: **${email}**\n`;
        response = `📞 **Entre em contato com nossa equipe:**\n\n${contactLine || '• Acesse o menu **Suporte** para informações de contato.\n'}\nEstamos disponíveis em horário comercial para ajudá-lo!`;
      } catch {
        response = `📞 Para falar com nossa equipe, acesse o menu **Suporte** ou verifique as informações de contato na página principal.`;
      }
    }

    else if (!isInternal && /como solicitar (alteração|mudança)|quero alterar|alterar escopo|mudar meu contrato/.test(msg) && company?.clientType !== 'contratual') {
      intent = 'client_scope_change_general';
      response = `🔄 Para solicitar alterações em seu contrato, entre em contato diretamente com nossa equipe comercial.\n\nDigite **"Como falar com o atendimento"** para ver nossos canais de contato.`;
    }

    else if (/ajuda|menu|opções|opcoes|o que (você|voce) (faz|pode)/.test(msg)) {
      intent = 'help';
      if (isInternal) {
        const extras = isAdmin ? '\n• "Criar empresa" — cadastrar nova empresa' : '';
        response = `🤖 **O que posso fazer:**\n\n📦 Consultas:\n• "Pedidos hoje" / "pedidos pendentes"\n• "Empresas que não fizeram pedido"\n\n📊 Inteligência:\n• "Analisar clientes" / "Clientes em risco"\n• "Prever faturamento" / "Ranking de clientes"\n• "Analisar logística" / "Agenda de entregas"\n• "Eficiência do sistema"\n\n📦 Operacional:\n• "Estoque baixo" / "Lista de compras"\n• "Criar tarefa"${extras}\n\n🌤️ Clima:\n• "Qual o clima em São Paulo?"\n\n❓ Novas funcionalidades:\n• "Como funciona o escopo contratual?"\n• "Como gerar uma nota fiscal?"\n• "Como funciona o custo médio?"\n• "Como funciona o ID de produto base?"`;
      } else {
        response = `🤖 **Posso ajudar com:**\n\n• "Meus pedidos" — ver status\n• "Previsão de entrega" — datas da janela\n• "Meu escopo" — frutas e quantidades do contrato\n• "Clima" — previsão do tempo\n• "Suporte" — contato com a equipe`;
      }
    }

    // ── Contratual client: scope change request ─────────────────────────────
    else if (!isInternal && company?.clientType === 'contratual' && sessionContext?.action === 'scope_change_confirm') {
      if (msg === 'confirmar' || msg === 'sim' || msg === 'ok') {
        intent = 'scope_change_confirmed';
        try {
          await storage.createTask({
            title: `Solicitação de alteração de escopo — ${company.companyName}`,
            description: `Cliente: ${company.companyName} (ID #${company.id})\nContato: ${company.contactName || '—'}\n\nMensagem do cliente:\n${sessionContext.data?.message || '(sem detalhes)'}`,
            priority: 'medium',
            createdByName: company.companyName,
          });
          response = `✅ Solicitação registrada! Nossa equipe entrará em contato em breve para confirmar as alterações no seu escopo contratual.`;
          newContext = null;
        } catch {
          response = `⚠️ Não foi possível registrar a solicitação. Tente novamente ou entre em contato diretamente conosco.`;
        }
      } else if (msg === 'cancelar' || msg === 'não' || msg === 'nao') {
        intent = 'scope_change_cancelled';
        response = `❌ Solicitação cancelada. Se precisar de ajuda, estou aqui!`;
        newContext = null;
      } else {
        response = `Digite **"confirmar"** para enviar a solicitação de alteração ou **"cancelar"** para desistir.`;
        newContext = sessionContext;
      }
    }

    // ── Contratual client: scope queries ─────────────────────────────────────
    else if (!isInternal && company?.clientType === 'contratual' &&
      /escopo|contrato|frutas|frutas que recebo|volume|valor|entrega|dias|quantidade|banana|manga|maçã|maca|alterar|alteração|mudar|solicitar|quero/.test(msg)) {
      intent = 'scope_query';
      try {
        const scopes = await storage.getContractScopes(company.id);

        if (/alterar|alteração|mudar|solicitar|quero|adicionar|trocar|reduzir|aumentar/.test(msg)) {
          const request = message.trim();
          newContext = { action: 'scope_change_confirm', data: { message: request } };
          response = `Entendi! Você deseja solicitar uma alteração no seu escopo contratual.\n\n📝 Sua solicitação:\n_"${request}"_\n\nDeseja que eu encaminhe essa solicitação para nossa equipe administrativa?\nDigite **"confirmar"** para enviar ou **"cancelar"** para desistir.`;
        } else {
          const DAY_LABELS: Record<string, string> = {
            'Segunda-feira': 'Segunda', 'Terça-feira': 'Terça', 'Quarta-feira': 'Quarta',
            'Quinta-feira': 'Quinta', 'Sexta-feira': 'Sexta',
          };
          const byDay: Record<string, typeof scopes> = {};
          for (const s of scopes) {
            const d = s.dayOfWeek || 'Sem dia';
            if (!byDay[d]) byDay[d] = [];
            byDay[d].push(s);
          }
          const valorSemanal = scopes.reduce((sum, s) => sum + Number(s.quantity) * (s.unitPrice ? Number(s.unitPrice) : 0), 0);
          const entregas = Object.keys(byDay).length;

          if (/valor|preço|custo|quanto custa|quanto pago/.test(msg)) {
            response = `💰 **Valor do seu contrato**\n\n• Valor semanal estimado: **R$ ${valorSemanal.toFixed(2).replace('.', ',')}**\n• Valor mensal estimado: **R$ ${(valorSemanal * 4).toFixed(2).replace('.', ',')}**\n• Entregas por semana: **${entregas}**\n\nPara mais detalhes acesse **Meu Escopo Contratual** no menu.`;
          } else if (/dia|dias|quando|entrega/.test(msg)) {
            const diasList = Object.keys(byDay).map(d => `• **${d}** — ${byDay[d]!.length} item(s)`).join('\n');
            response = `📅 **Seus dias de entrega**\n\n${diasList || '• Nenhum dia configurado ainda'}\n\nTotal de **${entregas}** entrega(s) por semana.`;
          } else if (/quantas|quantidade|quantos/.test(msg)) {
            const match = msg.match(/(banana|manga|maçã|maca|limão|limao|laranja|melão|melao|uva|morango)/);
            if (match && match[1]) {
              const fruit = match[1];
              const items = scopes.filter(s => (s as any).productName?.toLowerCase().includes(fruit) || (s as any).categoryName?.toLowerCase().includes(fruit));
              if (items.length === 0) {
                response = `🔍 Não encontrei **${fruit}** no seu escopo contratual atual.`;
              } else {
                const total = items.reduce((s, i) => s + Number(i.quantity), 0);
                const lines = items.map(i => `• ${i.dayOfWeek}: **${i.quantity} un** de ${(i as any).productName || fruit}`).join('\n');
                response = `🍎 **${fruit.charAt(0).toUpperCase() + fruit.slice(1)} no seu escopo:**\n\n${lines}\n\nTotal semanal: **${total} un**`;
              }
            } else {
              const totalItems = scopes.reduce((s, i) => s + Number(i.quantity), 0);
              response = `📦 **Volume total do seu escopo:** **${totalItems} unidades/semana**\n\n${scopes.map(s => `• ${s.dayOfWeek}: ${s.quantity} un de ${(s as any).productName || (s as any).categoryName || 'item'}`).join('\n')}`;
            }
          } else {
            const sections = Object.entries(byDay).map(([day, items]) => {
              const lines = items.map(i => `  • ${i.quantity} un de **${(i as any).productName || (i as any).categoryName || 'item'}**${i.unitPrice ? ` — R$ ${Number(i.unitPrice).toFixed(2).replace('.', ',')} cada` : ''}`).join('\n');
              const subtotal = items.reduce((s, i) => s + Number(i.quantity) * (i.unitPrice ? Number(i.unitPrice) : 0), 0);
              return `**${day}**\n${lines}${subtotal > 0 ? `\n  Subtotal: R$ ${subtotal.toFixed(2).replace('.', ',')}` : ''}`;
            }).join('\n\n');
            response = `🍃 **Seu escopo contratual:**\n\n${sections || 'Nenhum item configurado ainda.'}\n\n💰 Valor semanal estimado: **R$ ${valorSemanal.toFixed(2).replace('.', ',')}**\n\nPara solicitar alterações diga: _"Quero alterar..."_`;
          }
        }
      } catch {
        response = `⚠️ Não consegui acessar os dados do seu escopo agora. Tente novamente em instantes.`;
      }
    }

    else {
      intent = 'unknown';

      // ── Safety filter: block prohibited/sensitive topics ───────────────────
      const BLOCKED_TERMS = [
        'pornografia', 'porno', 'sexo', 'nude', 'adulto', 'erótico', 'erotico',
        'violência', 'violencia', 'matar', 'arma', 'explosivo',
        'droga', 'cocaína', 'heroína', 'crack', 'cannabis ilegal',
        'aposta', 'cassino', 'jogo de azar', 'bet',
        'hack', 'invadir', 'roubar', 'fraude',
        // Competitors (general fruit/food wholesale)
        'hortifruti', 'ceagesp', 'ceasinha',
      ];
      // Sensitive internal data that must NOT be shared externally
      const HAS_SENSITIVE_DATA = /cnpj|cpf|senha|contrato\s+\d|pedido\s+#\d|nota fiscal \d|cliente\s+\d{3,}/.test(msg);

      const isBlockedQuery = BLOCKED_TERMS.some(term => msg.toLowerCase().includes(term));

      if (isBlockedQuery) {
        response = `🚫 Essa pesquisa não está disponível nas políticas da plataforma.\n\nPosso ajudar com operações do sistema, produtos, pedidos e logística. Como posso te ajudar?`;
      } else if (isInternal && !HAS_SENSITIVE_DATA && msg.split(' ').length >= 3) {
        // ── External search via DuckDuckGo Instant Answer API ─────────────────
        // Only search for meaningful queries (3+ words), never with internal data
        try {
          const searchQuery = encodeURIComponent(msg.trim().slice(0, 100));
          const ddgUrl = `https://api.duckduckgo.com/?q=${searchQuery}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
          const ddgRes = await fetch(ddgUrl, { signal: AbortSignal.timeout(4000) });
          const ddgData = await ddgRes.json() as any;

          const abstractText = ddgData?.AbstractText?.trim();
          const abstractSource = ddgData?.AbstractURL?.trim();
          const relatedTopics = ddgData?.RelatedTopics?.slice(0, 3)?.map((t: any) => t?.Text).filter(Boolean) || [];

          if (abstractText && abstractText.length > 30) {
            intent = 'external_search';
            const sourceNote = abstractSource ? `\n\n🌐 Fonte: ${abstractSource}` : '';
            response = `🔍 **Pesquisa externa:**\n\n${abstractText}${relatedTopics.length > 0 ? `\n\n**Relacionados:**\n${relatedTopics.map((t: string) => `• ${t.slice(0, 80)}`).join('\n')}` : ''}${sourceNote}\n\n_Esta resposta é proveniente de busca externa. Para operações do sistema, use os atalhos do painel._`;
          } else {
            // No useful external result — fallback
            if (isInternal) {
              response = `Hmm, não encontrei informações sobre isso 🤔\n\nPosso ajudar com:\n📦 **Pedidos**: "pedidos hoje", "pedidos pendentes"\n📊 **Inteligência**: "clientes em risco", "prever faturamento"\n📦 **Estoque**: "estoque baixo", "lista de compras"\n❓ **Tutoriais**: "como funciona o escopo contratual?", "como gerar nota fiscal?"`;
            } else {
              response = `Não entendi 🤔 Tente:\n• "meus pedidos"\n• "previsão de entrega"\n• "suporte"`;
            }
          }
        } catch {
          // External search failed — fallback gracefully
          if (isInternal) {
            response = `Hmm, não entendi completamente 🤔 Sou a **Clara** e posso ajudar com:\n\n📦 **Pedidos**: "pedidos hoje", "pedidos pendentes"\n🏢 **Empresas**: "empresas inativas", "quem não fez pedido"\n📊 **Comercial**: "clientes em risco", "oportunidades de venda"\n💰 **Financeiro**: "prever faturamento", "ranking de clientes"\n🚚 **Logística**: "analisar logística", "agenda de entregas"\n📦 **Estoque**: "estoque baixo", "lista de compras"\n✅ **Tarefas**: "criar tarefa"\n🌤️ **Clima**: "clima em São Paulo"\n⚙️ **Sistema**: "status do sistema", "eficiência do sistema"${isAdmin ? '\n➕ **Criar**: "criar empresa"' : ''}\n\nTente reformular sua pergunta!`;
          } else {
            response = `Não entendi 🤔 Tente:\n• "meus pedidos"\n• "previsão de entrega"\n• "clima em São Paulo"\n• "suporte"`;
          }
        }
      } else if (isInternal) {
        response = `Hmm, não entendi completamente 🤔 Sou a **Clara** e posso ajudar com:\n\n📦 **Pedidos**: "pedidos hoje", "pedidos pendentes"\n🏢 **Empresas**: "empresas inativas", "quem não fez pedido"\n📊 **Comercial**: "clientes em risco", "oportunidades de venda"\n💰 **Financeiro**: "prever faturamento", "ranking de clientes"\n🚚 **Logística**: "analisar logística", "agenda de entregas"\n📦 **Estoque**: "estoque baixo", "lista de compras"\n✅ **Tarefas**: "criar tarefa"\n🌤️ **Clima**: "clima em São Paulo"\n⚙️ **Sistema**: "status do sistema", "eficiência do sistema"${isAdmin ? '\n➕ **Criar**: "criar empresa"' : ''}\n\n❓ **Tutoriais**: "como funciona o escopo contratual?", "como gerar nota fiscal?"\n\nTente reformular sua pergunta!`;
      } else if (company?.clientType === 'contratual') {
        response = `Não entendi 🤔 Sou a **Clara** e posso ajudar com:\n\n📋 **Escopo**: "quais frutas recebo", "meu volume semanal"\n📅 **Entregas**: "quais dias tenho entrega"\n💰 **Valor**: "qual o valor do meu contrato"\n🔄 **Alterações**: "quero alterar meu escopo"`;
      } else {
        response = `Não entendi 🤔 Tente:\n• "meus pedidos"\n• "previsão de entrega"\n• "clima em São Paulo"\n• "suporte"`;
      }
    }

    // Save interaction to history
    // SECURITY: stamp tenantId so the row is reachable via tenantWhere(aiInteractions).
    // Falls back to company.empresaId / user.empresaId; null only when neither side
    // has a resolvable tenant (legacy support before users/companies linked).
    try {
      const tenantId =
        company?.id ?? company?.empresaId ?? user?.empresaId ?? null;
      await db.insert(aiInteractions).values({
        userId: user?.id || null,
        companyId: company?.id || null,
        userRole: user?.role || (company ? 'CLIENT' : null),
        userName: user?.name || company?.companyName || null,
        message: message.trim(),
        response,
        intent,
        actionExecuted,
        actionData: actionData ? actionData : null,
        tenantId,
      });
    } catch { /* ignore history save errors */ }

    res.json({ response, intent, sessionContext: newContext || null });
  });
}
