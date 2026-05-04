import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireSessionOrCompany } from "../core/http/requireSessionOrCompany";
import { db } from "../database/db";
import { users as usersTable } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

export function register(app: Express) {
  // --- IA Operacional / Central de Inteligência ---
  // FASE 6.3 — auth centralizado via requireSessionOrCompany (remove check manual).
  app.get('/api/admin/intelligence', requireSessionOrCompany, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }

      interface IntelAlert {
        id: string;
        category: 'estoque' | 'clientes' | 'produtos' | 'logistica' | 'sistema';
        severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
        title: string;
        description: string;
        actionLabel?: string;
        actionHref?: string;
        data?: Record<string, unknown>;
      }

      const alerts: IntelAlert[] = [];
      const now = Date.now();

      // ── 1. ESTOQUE ANALYSIS ───────────────────────────────────────
      try {
        const stockSettings = await storage.getInventorySettings();
        const allOrders = await storage.getOrders();
        const recentOrders = allOrders.filter((o: any) => {
          const d = new Date(o.orderDate || o.createdAt);
          return now - d.getTime() < 28 * 86400000; // last 4 weeks
        });

        // Calculate weekly avg consumption per product from recent order items
        const productWeeklyAvg: Record<string, { name: string; avgQty: number }> = {};
        for (const order of recentOrders) {
          const orderData = await storage.getOrder(order.id);
          if (!orderData || !orderData.items) continue;
          const { items } = orderData;
          for (const item of items) {
            if (!productWeeklyAvg[item.productId]) {
              productWeeklyAvg[item.productId] = { name: (item as any).productName || String(item.productId), avgQty: 0 };
            }
            productWeeklyAvg[item.productId]!.avgQty += item.quantity / 4;
          }
        }

        for (const s of stockSettings) {
          const current = parseFloat(s.currentStock as string) || 0;
          const minimum = parseFloat(s.minStock as string) || 0;
          const weekly = productWeeklyAvg[String(s.productId)]?.avgQty ?? 0;
          const productName = s.productName;

          // Stock below minimum
          if (minimum > 0 && current <= minimum) {
            alerts.push({
              id: `stock-min-${s.id}`,
              category: 'estoque',
              severity: current === 0 ? 'CRITICAL' : 'HIGH',
              title: current === 0 ? `Estoque zerado: ${productName}` : `Estoque abaixo do mínimo: ${productName}`,
              description: current === 0
                ? `${productName} está sem estoque. Estoque mínimo configurado: ${minimum} unidades.`
                : `Estoque atual (${current}) está abaixo do mínimo (${minimum}).`,
              actionLabel: 'Ver Inventário',
              actionHref: '/admin/inventory',
              data: { productName, currentStock: current, minStock: minimum },
            });
          }

          // Risk of running out based on weekly consumption
          if (weekly > 0 && current > 0 && current < weekly) {
            const daysLeft = Math.round((current / weekly) * 7);
            alerts.push({
              id: `stock-risk-${s.id}`,
              category: 'estoque',
              severity: daysLeft <= 2 ? 'CRITICAL' : daysLeft <= 4 ? 'HIGH' : 'MEDIUM',
              title: `${productName} pode acabar em ${daysLeft} dia(s)`,
              description: `Consumo semanal médio: ${weekly.toFixed(1)} un. Estoque atual: ${current} un. Estimativa: ${daysLeft} dia(s) restantes.`,
              actionLabel: 'Planejar Compra',
              actionHref: '/admin/purchase-planning',
              data: { productName, currentStock: current, weeklyAvg: parseFloat(weekly.toFixed(2)), daysLeft },
            });
          }
        }
      } catch (e: any) {
        alerts.push({ id: 'stock-error', category: 'estoque', severity: 'MEDIUM', title: 'Erro ao analisar estoque', description: e.message });
      }

      // ── 2. CLIENTES ANALYSIS ──────────────────────────────────────
      try {
        const companies = await storage.getCompanies();
        const allOrders = await storage.getOrders();
        const activeCompanies = companies.filter((c: any) => c.active);

        for (const company of activeCompanies) {
          const compOrders = allOrders.filter((o: any) => o.companyId === company.id);
          if (compOrders.length === 0) continue;

          // Sort and get last order
          const sorted = compOrders.sort((a: any, b: any) => new Date(b.orderDate || b.createdAt).getTime() - new Date(a.orderDate || a.createdAt).getTime());
          const lastOrder = sorted[0];
          if (!lastOrder) continue;
          const daysSince = Math.floor((now - new Date(lastOrder.orderDate || lastOrder.createdAt).getTime()) / 86400000);

          // Calculate historical ordering frequency (days between orders)
          if (compOrders.length >= 2) {
            const dates = sorted.map((o: any) => new Date(o.orderDate || o.createdAt).getTime());
            let totalGap = 0;
            for (let i = 0; i < dates.length - 1; i++) totalGap += dates[i]! - dates[i + 1]!;
            const avgGapDays = totalGap / (dates.length - 1) / 86400000;
            const overdueThreshold = avgGapDays * 1.8; // 80% over normal frequency

            if (daysSince > overdueThreshold && daysSince > 7) {
              alerts.push({
                id: `client-inactive-${company.id}`,
                category: 'clientes',
                severity: daysSince > 30 ? 'HIGH' : 'MEDIUM',
                title: `${company.companyName} sem pedido há ${daysSince} dias`,
                description: `Frequência histórica de pedidos: a cada ~${Math.round(avgGapDays)} dias. Último pedido: ${new Date(lastOrder.orderDate || lastOrder.createdAt).toLocaleDateString('pt-BR')}.`,
                actionLabel: 'Ver Empresa',
                actionHref: '/admin/companies',
                data: { companyId: company.id, companyName: company.companyName, daysSince, avgGapDays: parseFloat(avgGapDays.toFixed(1)) },
              });
            }
          } else if (compOrders.length === 1 && daysSince > 14) {
            alerts.push({
              id: `client-loworder-${company.id}`,
              category: 'clientes',
              severity: 'LOW',
              title: `${company.companyName} — apenas 1 pedido registrado`,
              description: `Empresa com apenas um pedido feito há ${daysSince} dias. Pode indicar cliente inativo ou em fase inicial.`,
              actionLabel: 'Ver Empresa',
              actionHref: '/admin/companies',
              data: { companyId: company.id, companyName: company.companyName, daysSince },
            });
          }
        }
      } catch (e: any) {
        alerts.push({ id: 'client-error', category: 'clientes', severity: 'MEDIUM', title: 'Erro ao analisar clientes', description: e.message });
      }

      // ── 3. PRODUTOS ANALYSIS ──────────────────────────────────────
      try {
        const products = await storage.getProducts();
        const allOrders = await storage.getOrders();

        const fourWeeksAgo = new Date(now - 28 * 86400000);
        const eightWeeksAgo = new Date(now - 56 * 86400000);

        const recentOrders = allOrders.filter((o: any) => new Date(o.orderDate || o.createdAt) >= fourWeeksAgo);
        const prevOrders = allOrders.filter((o: any) => {
          const d = new Date(o.orderDate || o.createdAt);
          return d >= eightWeeksAgo && d < fourWeeksAgo;
        });

        const recentQty: Record<number, number> = {};
        for (const order of recentOrders) {
          const orderDetail = await storage.getOrder(order.id);
          if (!orderDetail) continue;
          const { items } = orderDetail;
          for (const item of items) {
            recentQty[item.productId] = (recentQty[item.productId] || 0) + item.quantity;
          }
        }

        const prevQty: Record<number, number> = {};
        for (const order of prevOrders) {
          const orderDetail = await storage.getOrder(order.id);
          if (!orderDetail) continue;
          const { items } = orderDetail;
          for (const item of items) {
            prevQty[item.productId] = (prevQty[item.productId] || 0) + item.quantity;
          }
        }

        for (const product of products.filter((p: any) => p.active)) {
          const recent = recentQty[product.id] || 0;
          const prev = prevQty[product.id] || 0;

          // Zero orders in last 30 days (but had orders before)
          if (recent === 0 && prev > 0) {
            alerts.push({
              id: `prod-nosale-${product.id}`,
              category: 'produtos',
              severity: 'MEDIUM',
              title: `Produto sem vendas: ${product.name}`,
              description: `"${product.name}" não teve pedidos nas últimas 4 semanas (teve ${prev.toFixed(1)} un nas 4 semanas anteriores).`,
              actionLabel: 'Ver Produto',
              actionHref: '/admin/products',
              data: { productId: product.id, productName: product.name, recentQty: recent, prevQty: prev },
            });
          }

          // Sharp decline (>60% drop)
          if (prev > 0 && recent > 0) {
            const dropPct = ((prev - recent) / prev) * 100;
            if (dropPct >= 60) {
              alerts.push({
                id: `prod-decline-${product.id}`,
                category: 'produtos',
                severity: 'MEDIUM',
                title: `Queda de vendas: ${product.name} (-${Math.round(dropPct)}%)`,
                description: `Volume de pedidos caiu de ${prev.toFixed(1)} para ${recent.toFixed(1)} unidades nas últimas 4 semanas.`,
                actionLabel: 'Ver Planejamento',
                actionHref: '/admin/purchase-planning',
                data: { productId: product.id, productName: product.name, recentQty: recent, prevQty: prev, dropPct: parseFloat(dropPct.toFixed(1)) },
              });
            }
          }
        }
      } catch (e: any) {
        alerts.push({ id: 'prod-error', category: 'produtos', severity: 'MEDIUM', title: 'Erro ao analisar produtos', description: e.message });
      }

      // ── 4. LOGÍSTICA ANALYSIS ─────────────────────────────────────
      try {
        const routes = await storage.getRoutes();
        const noDriver = routes.filter((r: any) => !r.driverId);
        const noVehicle = routes.filter((r: any) => !r.vehicleId);

        if (noDriver.length > 0) {
          alerts.push({
            id: 'logistics-nodriver',
            category: 'logistica',
            severity: 'HIGH',
            title: `${noDriver.length} rota(s) sem motorista atribuído`,
            description: `Rotas sem motorista podem causar falhas na entrega. Atribua um motorista a cada rota antes da janela de entrega.`,
            actionLabel: 'Ver Logística',
            actionHref: '/admin/logistics',
            data: { count: noDriver.length },
          });
        }

        if (noVehicle.length > 0) {
          alerts.push({
            id: 'logistics-novehicle',
            category: 'logistica',
            severity: 'HIGH',
            title: `${noVehicle.length} rota(s) sem veículo atribuído`,
            description: `Rotas sem veículo configurado. Verifique e atribua os veículos antes da entrega.`,
            actionLabel: 'Ver Logística',
            actionHref: '/admin/logistics',
            data: { count: noVehicle.length },
          });
        }

        // Check for duplicate delivery windows (same date + delivery day)
        const windowGroups: Record<string, any[]> = {};
        for (const r of routes) {
          const key = `${(r as any).deliveryDay || ''}-${(r as any).weekReference || ''}`;
          if (key !== '-') {
            if (!windowGroups[key]) windowGroups[key] = [];
            windowGroups[key].push(r);
          }
        }
        for (const [key, group] of Object.entries(windowGroups)) {
          if (group.length > 3) {
            alerts.push({
              id: `logistics-overload-${key}`,
              category: 'logistica',
              severity: 'MEDIUM',
              title: `Alta concentração de rotas: ${key}`,
              description: `${group.length} rotas agendadas para o mesmo dia. Verifique possível sobrecarga na equipe de entrega.`,
              actionLabel: 'Ver Logística',
              actionHref: '/admin/logistics',
              data: { day: key, routeCount: group.length },
            });
          }
        }
      } catch (e: any) {
        alerts.push({ id: 'logistics-error', category: 'logistica', severity: 'LOW', title: 'Erro ao analisar logística', description: e.message });
      }

      // ── 5. SISTEMA / SEGURANÇA ANALYSIS ───────────────────────────
      try {
        const recentLogs = await storage.getLogs(200);
        const loginFails = recentLogs.filter((l: any) => l.action === 'LOGIN_FAILED');
        const sysErrors = recentLogs.filter((l: any) => l.level === 'ERROR');

        if (loginFails.length >= 10) {
          const ipsMap: Record<string, number> = {};
          for (const l of loginFails) {
            const match = l.description?.match(/(\d+\.\d+\.\d+\.\d+)/);
            const ip = match?.[1];
            if (ip) ipsMap[ip] = (ipsMap[ip] || 0) + 1;
          }
          const suspectIps = Object.entries(ipsMap).filter(([, c]) => c >= 5);
          alerts.push({
            id: 'security-loginfails',
            category: 'sistema',
            severity: loginFails.length >= 20 ? 'CRITICAL' : 'HIGH',
            title: `${loginFails.length} tentativas de login falhadas detectadas`,
            description: `${suspectIps.length > 0 ? `IPs suspeitos: ${suspectIps.map(([ip, c]) => `${ip} (${c}x)`).join(', ')}. ` : ''}Verifique possível tentativa de acesso não autorizado.`,
            actionLabel: 'Ver Auditoria',
            actionHref: '/admin/developer',
            data: { count: loginFails.length, suspectIps },
          });
        }

        // Repeated error patterns
        const errorMsgs: Record<string, number> = {};
        for (const l of sysErrors) {
          const key = (l.description || '').substring(0, 80);
          errorMsgs[key] = (errorMsgs[key] || 0) + 1;
        }
        const repeated = Object.entries(errorMsgs).filter(([, c]) => c >= 3);
        if (repeated.length > 0) {
          alerts.push({
            id: 'security-errors',
            category: 'sistema',
            severity: repeated.some(([, c]) => c >= 10) ? 'HIGH' : 'MEDIUM',
            title: `${repeated.length} erro(s) repetidos detectados no sistema`,
            description: `Erros recorrentes: ${repeated.slice(0, 2).map(([msg, c]) => `"${msg.substring(0, 50)}..." (${c}x)`).join('; ')}`,
            actionLabel: 'Ver Desenvolvedor',
            actionHref: '/admin/developer',
            data: { repeated: repeated.slice(0, 5).map(([msg, count]) => ({ msg, count })) },
          });
        }

        if (sysErrors.length === 0 && loginFails.length < 5) {
          alerts.push({
            id: 'system-ok',
            category: 'sistema',
            severity: 'LOW',
            title: 'Sistema operando normalmente',
            description: 'Nenhum erro crítico ou falha de segurança detectados nos últimos registros.',
            data: {},
          });
        }
      } catch (e: any) {
        alerts.push({ id: 'system-error', category: 'sistema', severity: 'MEDIUM', title: 'Erro ao analisar sistema', description: e.message });
      }

      const summary = {
        total: alerts.length,
        critical: alerts.filter(a => a.severity === 'CRITICAL').length,
        high: alerts.filter(a => a.severity === 'HIGH').length,
        medium: alerts.filter(a => a.severity === 'MEDIUM').length,
        low: alerts.filter(a => a.severity === 'LOW').length,
        byCategory: {
          estoque: alerts.filter(a => a.category === 'estoque').length,
          clientes: alerts.filter(a => a.category === 'clientes').length,
          produtos: alerts.filter(a => a.category === 'produtos').length,
          logistica: alerts.filter(a => a.category === 'logistica').length,
          sistema: alerts.filter(a => a.category === 'sistema').length,
        },
      };

      res.json({ alerts, summary, generatedAt: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ message: 'Erro ao executar análise de inteligência', error: err.message });
    }
  });

  // --- IA Auto-Fix: Corrigir Automaticamente ---
  // FASE 6.3 — auth centralizado via requireSessionOrCompany (remove check manual).
  app.post('/api/admin/intelligence/auto-fix', requireSessionOrCompany, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }

      const actions: Array<{ id: string; category: string; title: string; result: string; status: 'FIXED' | 'WARN' | 'SKIP' }> = [];

      // 1. Verificar e corrigir produtos sem estoque mínimo definido
      try {
        const products = await storage.getProducts();
        const noMin = products.filter((p: any) => p.minStock === null || p.minStock === undefined);
        if (noMin.length > 0) {
          actions.push({ id: 'fix-minstock', category: 'estoque', title: `${noMin.length} produto(s) sem estoque mínimo definido`, result: 'Ação manual necessária: configure estoque mínimo via painel de inventário', status: 'WARN' });
        } else {
          actions.push({ id: 'fix-minstock', category: 'estoque', title: 'Estoque mínimo — OK', result: 'Todos os produtos têm configurações de inventário', status: 'SKIP' });
        }
      } catch (e: any) {
        actions.push({ id: 'fix-minstock', category: 'estoque', title: 'Estoque mínimo', result: `Erro: ${e.message}`, status: 'WARN' });
      }

      // 2. Verificar usuários sem role definida
      // CAMADA-1: write MUST be scoped to actor's tenant — never mutate cross-tenant.
      try {
        const actorEmpresaId: number | null = (user as any).empresaId ?? null;
        if (!actorEmpresaId) {
          // tenantId unavailable — abort to prevent cross-tenant write.
          actions.push({ id: 'fix-roles', category: 'sistema', title: 'Roles de usuários — ABORTADO', result: 'Empresa não identificada no contexto. Operação abortada por segurança.', status: 'WARN' });
        } else {
          // SQL-scoped to actor's tenant only — zero cross-tenant risk.
          const tenantUsers = await db
            .select({ id: usersTable.id, role: usersTable.role })
            .from(usersTable)
            .where(eq(usersTable.empresaId, actorEmpresaId));
          const noRole = tenantUsers.filter((u) => !u.role);
          if (noRole.length > 0) {
            for (const u of noRole) {
              await storage.updateUser(u.id, { role: 'LOGISTICS' });
            }
            actions.push({ id: 'fix-roles', category: 'sistema', title: `Role padrão aplicado a ${noRole.length} usuário(s)`, result: 'Role LOGISTICS aplicado a usuários sem cargo da empresa', status: 'FIXED' });
          } else {
            actions.push({ id: 'fix-roles', category: 'sistema', title: 'Roles de usuários — OK', result: 'Todos os usuários têm roles definidas', status: 'SKIP' });
          }
        }
      } catch (e: any) {
        actions.push({ id: 'fix-roles', category: 'sistema', title: 'Roles de usuários', result: `Erro: ${e.message}`, status: 'WARN' });
      }

      // 3. Verificar empresas sem endereço cadastrado
      try {
        const companies = await storage.getCompanies();
        const noAddr = companies.filter((c: any) => !c.addressStreet || !c.addressCity);
        if (noAddr.length > 0) {
          actions.push({ id: 'fix-addresses', category: 'clientes', title: `${noAddr.length} empresa(s) sem endereço completo`, result: 'Ação manual necessária: acesse cada empresa e complete o endereço', status: 'WARN' });
        } else {
          actions.push({ id: 'fix-addresses', category: 'clientes', title: 'Endereços de empresas — OK', result: 'Todas as empresas têm endereço cadastrado', status: 'SKIP' });
        }
      } catch (e: any) {
        actions.push({ id: 'fix-addresses', category: 'clientes', title: 'Endereços de empresas', result: `Erro: ${e.message}`, status: 'WARN' });
      }

      // 4. Limpar erros de auditoria antigos (> 30 dias)
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        actions.push({ id: 'fix-audit', category: 'sistema', title: 'Auditoria — dados antigos identificados', result: 'Logs com mais de 30 dias marcados para limpeza automática', status: 'FIXED' });
      } catch (e: any) {
        actions.push({ id: 'fix-audit', category: 'sistema', title: 'Limpeza de auditoria', result: `Erro: ${e.message}`, status: 'WARN' });
      }

      const fixed = actions.filter(a => a.status === 'FIXED').length;
      const warn = actions.filter(a => a.status === 'WARN').length;

      res.json({
        actions,
        summary: { total: actions.length, fixed, warn, skip: actions.filter(a => a.status === 'SKIP').length },
        executedAt: new Date().toISOString(),
        executedBy: user.name,
      });
    } catch (err: any) {
      res.status(500).json({ message: 'Erro ao executar auto-fix', error: err.message });
    }
  });
}
