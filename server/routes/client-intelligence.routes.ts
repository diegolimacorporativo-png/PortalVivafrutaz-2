import type { Express } from "express";
import { storage } from "../services/storage.ts";

export function register(app: Express) {
  // ─── Commercial Intelligence ─────────────────────────────────────────────
  app.get('/api/commercial-intelligence', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }
      const now = Date.now();
      const allOrders = await storage.getOrders();
      const allCompanies = await storage.getCompanies();
      const activeCompanies = allCompanies.filter((c: any) => c.active);

      // Group orders by company
      const ordersByCompany: Record<number, any[]> = {};
      for (const o of allOrders) {
        if (!ordersByCompany[o.companyId]) ordersByCompany[o.companyId] = [];
        ordersByCompany[o.companyId]!.push(o);
      }

      // Build product order history per company (for dropped products)
      const productHistoryByCompany: Record<number, Record<number, { productName: string; lastOrdered: number; totalOrders: number }>> = {};
      for (const o of allOrders.filter((o: any) => o.status !== 'CANCELLED')) {
        const orderDate = new Date(o.orderDate || o.createdAt).getTime();
        if (!productHistoryByCompany[o.companyId]) productHistoryByCompany[o.companyId] = {};
        try {
          const { items } = await storage.getOrder(o.id) || { items: [] };
          for (const item of items) {
            if (!productHistoryByCompany[o.companyId]![item.productId]) {
              productHistoryByCompany[o.companyId]![item.productId] = { productName: (item as any).productName || `Produto #${item.productId}`, lastOrdered: 0, totalOrders: 0 };
            }
            if (orderDate > productHistoryByCompany[o.companyId]![item.productId]!.lastOrdered) {
              productHistoryByCompany[o.companyId]![item.productId]!.lastOrdered = orderDate;
            }
            productHistoryByCompany[o.companyId]![item.productId]!.totalOrders++;
          }
        } catch { /* skip */ }
      }

      const atRisk: any[] = [];
      const opportunities: any[] = [];

      for (const company of activeCompanies) {
        const compOrders = (ordersByCompany[company.id] || []).filter((o: any) => o.status !== 'CANCELLED');
        if (compOrders.length === 0) continue; // never ordered — skip (they're just inactive)

        // Sort orders by date
        const sorted = compOrders.sort((a: any, b: any) => new Date(b.orderDate || b.createdAt).getTime() - new Date(a.orderDate || a.createdAt).getTime());
        const lastOrderDate = new Date(sorted[0].orderDate || sorted[0].createdAt);
        const daysSinceLastOrder = Math.floor((now - lastOrderDate.getTime()) / 86400000);

        // Calculate average weekly order value from all historical orders
        const totalValue = compOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
        const avgOrderValue = totalValue / compOrders.length;

        // Find recent orders (last 14 days)
        const recentOrders = compOrders.filter((o: any) => now - new Date(o.orderDate || o.createdAt).getTime() < 14 * 86400000);
        const recentValue = recentOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);

        // Older orders (14–28 days ago)
        const olderOrders = compOrders.filter((o: any) => {
          const age = now - new Date(o.orderDate || o.createdAt).getTime();
          return age >= 14 * 86400000 && age < 28 * 86400000;
        });
        const olderValue = olderOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);

        // Client at risk: no orders in 14+ days (but had orders in the 28 days before that)
        if (daysSinceLastOrder >= 14 && olderOrders.length > 0) {
          let riskLevel: 'high' | 'medium' | 'low' = 'medium';
          if (daysSinceLastOrder >= 30) riskLevel = 'high';
          else if (daysSinceLastOrder >= 14) riskLevel = 'medium';

          atRisk.push({
            companyId: company.id,
            companyName: company.companyName,
            daysSinceLastOrder,
            lastOrderDate: lastOrderDate.toISOString(),
            avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
            totalOrders: compOrders.length,
            riskLevel,
          });
        }

        // Significant drop alert: recent value < 50% of older value
        if (olderValue > 0 && recentValue < olderValue * 0.5 && recentOrders.length > 0) {
          const dropPct = Math.round((1 - recentValue / olderValue) * 100);
          opportunities.push({
            type: 'volume_drop',
            companyId: company.id,
            companyName: company.companyName,
            dropPercent: dropPct,
            recentValue: parseFloat(recentValue.toFixed(2)),
            previousValue: parseFloat(olderValue.toFixed(2)),
            description: `Queda de ${dropPct}% no volume de compras em relação às 2 semanas anteriores.`,
            suggestion: 'Entrar em contato para verificar necessidade de reposição.',
          });
        }

        // Dropped products: products ordered before but not in the last 14 days
        const prodHistory = productHistoryByCompany[company.id] || {};
        for (const [, prod] of Object.entries(prodHistory)) {
          const daysSinceProduct = Math.floor((now - prod.lastOrdered) / 86400000);
          if (daysSinceProduct >= 14 && prod.totalOrders >= 2) {
            opportunities.push({
              type: 'dropped_product',
              companyId: company.id,
              companyName: company.companyName,
              productName: prod.productName,
              daysSinceProduct,
              totalOrders: prod.totalOrders,
              description: `${company.companyName} não pediu **${prod.productName}** há ${daysSinceProduct} dias.`,
              suggestion: `Oferecer ${prod.productName} para reposição.`,
            });
          }
        }
      }

      // Sort at risk by days descending
      atRisk.sort((a, b) => b.daysSinceLastOrder - a.daysSinceLastOrder);

      res.json({ atRisk, opportunities: opportunities.slice(0, 30), generatedAt: new Date().toISOString() });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── Financial Intelligence ───────────────────────────────────────────────
  app.get('/api/financial-intelligence', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'FINANCEIRO'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

      const allOrders = await storage.getOrders();
      const allCompanies = await storage.getCompanies();
      const confirmedStatuses = ['CONFIRMED', 'ACTIVE'];

      const validOrders = allOrders.filter((o: any) => o.status !== 'CANCELLED');
      const thisMonthOrders = validOrders.filter((o: any) => new Date(o.orderDate || o.createdAt) >= startOfMonth);
      const lastMonthOrders = validOrders.filter((o: any) => {
        const d = new Date(o.orderDate || o.createdAt);
        return d >= startOfLastMonth && d <= endOfLastMonth;
      });

      const thisMonthRevenue = thisMonthOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
      const lastMonthRevenue = lastMonthOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
      const monthGrowth = lastMonthRevenue > 0 ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 : 0;

      // Revenue by company
      const revenueByCompany: Record<number, { companyName: string; total: number; orderCount: number }> = {};
      for (const o of validOrders) {
        if (!revenueByCompany[o.companyId]) {
          const comp = allCompanies.find((c: any) => c.id === o.companyId);
          revenueByCompany[o.companyId] = { companyName: comp?.companyName || `#${o.companyId}`, total: 0, orderCount: 0 };
        }
        revenueByCompany[o.companyId]!.total += parseFloat(o.totalValue || '0');
        revenueByCompany[o.companyId]!.orderCount++;
      }

      const topClients = Object.entries(revenueByCompany)
        .map(([id, v]) => ({ companyId: Number(id), ...v, avgOrder: v.total / v.orderCount }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
        .map(c => ({ ...c, total: parseFloat(c.total.toFixed(2)), avgOrder: parseFloat(c.avgOrder.toFixed(2)) }));

      // Historical monthly revenue (last 6 months)
      const monthlyRevenue: { month: string; revenue: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        const mOrders = validOrders.filter((o: any) => {
          const d = new Date(o.orderDate || o.createdAt);
          return d >= mStart && d <= mEnd;
        });
        const mRevenue = mOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || '0'), 0);
        monthlyRevenue.push({
          month: mStart.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
          revenue: parseFloat(mRevenue.toFixed(2)),
        });
      }

      // Forecast: average of last 3 months * remaining days ratio
      const last3Avg = monthlyRevenue.slice(-3).reduce((s, m) => s + m.revenue, 0) / 3;
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const dayOfMonth = now.getDate();
      const forecast = parseFloat((thisMonthRevenue + (last3Avg / daysInMonth) * (daysInMonth - dayOfMonth)).toFixed(2));

      const avgLast3Months = parseFloat(last3Avg.toFixed(2));
      const revenueAlert = avgLast3Months > 0 && thisMonthRevenue < avgLast3Months * 0.8;

      res.json({
        thisMonthRevenue: parseFloat(thisMonthRevenue.toFixed(2)),
        lastMonthRevenue: parseFloat(lastMonthRevenue.toFixed(2)),
        monthGrowth: parseFloat(monthGrowth.toFixed(1)),
        forecastRevenue: forecast,
        avgLast3Months,
        revenueAlert,
        topClients,
        monthlyRevenue,
        thisMonthOrderCount: thisMonthOrders.length,
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── Logistics Intelligence ───────────────────────────────────────────────
  app.get('/api/logistics-intelligence', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }
      const now = new Date();
      const allOrders = await storage.getOrders();
      const routes = await storage.getRoutes();
      const activeWindow = await storage.getActiveOrderWindow();

      // Delivery schedule: group active orders by delivery date
      const activeOrders = allOrders.filter((o: any) => !['CANCELLED'].includes(o.status));
      const deliverySchedule: Record<string, { date: string; count: number; totalValue: number; companies: string[] }> = {};
      const allCompanies = await storage.getCompanies();

      for (const o of activeOrders) {
        if (!o.deliveryDate) continue;
        const dateKey = new Date(o.deliveryDate).toLocaleDateString('pt-BR');
        if (!deliverySchedule[dateKey]) {
          deliverySchedule[dateKey] = { date: dateKey, count: 0, totalValue: 0, companies: [] };
        }
        deliverySchedule[dateKey].count++;
        deliverySchedule[dateKey].totalValue += parseFloat(o.totalValue || '0');
        const comp = allCompanies.find((c: any) => c.id === o.companyId);
        if (comp && !deliverySchedule[dateKey].companies.includes(comp.companyName)) {
          deliverySchedule[dateKey].companies.push(comp.companyName);
        }
      }

      const scheduleArray = Object.values(deliverySchedule).sort((a, b) => {
        const [da = 0, ma = 0, ya = 0] = a.date.split('/').map(Number);
        const [db = 0, mb = 0, yb = 0] = b.date.split('/').map(Number);
        return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
      }).map(d => ({ ...d, totalValue: parseFloat(d.totalValue.toFixed(2)) }));

      // Overload threshold: > 5 deliveries on same day
      const overloadThreshold = 5;
      const overloadedDays = scheduleArray.filter(d => d.count >= overloadThreshold);

      // Busiest day
      const busiestDay = scheduleArray.length > 0 ? scheduleArray.reduce((a, b) => b.count > a.count ? b : a) : null;

      // Route capacity (simplified: order count per route based on route assignment)
      const routeCapacity = routes.map((r: any) => ({
        routeId: r.id,
        routeName: r.name,
        status: r.status || 'active',
        assignedCompanies: r.assignedCompanies || [],
        hasVehicle: !!r.vehicleId,
        hasDriver: !!r.driverId,
      }));

      const activeRoute = routes.filter((r: any) => r.status !== 'inactive');
      const unassignedRoutes = routes.filter((r: any) => !r.vehicleId || !r.driverId);

      res.json({
        activeRoutes: activeRoute.length,
        totalRoutes: routes.length,
        unassignedRoutes: unassignedRoutes.length,
        deliverySchedule: scheduleArray,
        overloadedDays,
        busiestDay,
        routeCapacity,
        activeWindow: activeWindow ? { weekReference: activeWindow.weekReference } : null,
        totalActiveDeliveries: activeOrders.length,
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}
