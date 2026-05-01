import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { db } from "../database/db.ts";
import { orders, orderItems } from "@shared/schema";
import { gte } from "drizzle-orm";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";

export function register(app: Express) {
  // ─── DASHBOARD EXECUTIVO ─────────────────────────────────────
  // SECURITY: Cross-tenant by design (executive overview spans all empresas).
  // Locked behind requireAuth + requireRole — only admin-level roles can read.
  // Direct db.select() below is intentional and gated by the role check.
  app.get('/api/executive-dashboard',
    requireAuthCore,
    requireRole(['MASTER', 'ADMIN', 'DIRECTOR', 'FINANCEIRO', 'DEVELOPER']),
    async (req, res) => {
    try {
      const { period = 'month' } = req.query;
      const now = new Date();
      let startDate: Date;
      if (period === 'day') { startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
      else if (period === 'week') { const d = new Date(now); d.setDate(d.getDate() - d.getDay() + 1); startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
      else if (period === 'year') { startDate = new Date(now.getFullYear(), 0, 1); }
      else { startDate = new Date(now.getFullYear(), now.getMonth(), 1); } // month

      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); weekStart.setHours(0,0,0,0);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const allOrders = await db.select().from(orders).where(gte(orders.orderDate, monthStart));
      const allCompanies = await storage.getCompanies();

      // Revenue KPIs
      const allOrdersAll = await db.select().from(orders);
      const todayOrders = allOrdersAll.filter(o => new Date(o.orderDate) >= todayStart);
      const weekOrders = allOrdersAll.filter(o => new Date(o.orderDate) >= weekStart);
      const monthOrders = allOrdersAll.filter(o => new Date(o.orderDate) >= monthStart);

      const sum = (arr: typeof allOrdersAll) => arr.filter(o => o.status !== 'CANCELLED').reduce((acc, o) => acc + parseFloat(o.totalValue || '0'), 0);
      const revenueDay = sum(todayOrders);
      const revenueWeek = sum(weekOrders);
      const revenueMonth = sum(monthOrders);
      const avgTicketMonth = monthOrders.filter(o => o.status !== 'CANCELLED').length > 0
        ? revenueMonth / monthOrders.filter(o => o.status !== 'CANCELLED').length : 0;

      // Top companies
      const companyMap: Record<string, { companyId: number; companyName: string; total: number; count: number }> = {};
      const periodOrders = allOrdersAll.filter(o => new Date(o.orderDate) >= startDate);
      for (const o of periodOrders.filter(x => x.status !== 'CANCELLED')) {
        if (!companyMap[o.companyId]) {
          const co = allCompanies.find(c => c.id === o.companyId);
          companyMap[o.companyId] = { companyId: o.companyId, companyName: co?.companyName || `Empresa #${o.companyId}`, total: 0, count: 0 };
        }
        companyMap[o.companyId]!.total += parseFloat(o.totalValue || '0');
        companyMap[o.companyId]!.count += 1;
      }
      const topCompanies = Object.values(companyMap).sort((a, b) => b.total - a.total).slice(0, 10);

      // Top products
      const allItems = await db.select({ orderId: orderItems.orderId, productId: orderItems.productId, quantity: orderItems.quantity, totalPrice: orderItems.totalPrice }).from(orderItems);
      const periodOrderIds = new Set(periodOrders.map(o => o.id));
      const productMap: Record<number, { productId: number; productName: string; qty: number; total: number }> = {};
      const allProds = await storage.getProducts();
      for (const item of allItems.filter(i => periodOrderIds.has(i.orderId))) {
        if (!productMap[item.productId]) {
          const pr = allProds.find(p => p.id === item.productId);
          productMap[item.productId] = { productId: item.productId, productName: pr?.name || `Produto #${item.productId}`, qty: 0, total: 0 };
        }
        productMap[item.productId]!.qty += item.quantity;
        productMap[item.productId]!.total += parseFloat(item.totalPrice || '0');
      }
      const topProducts = Object.values(productMap).sort((a, b) => b.total - a.total).slice(0, 10);

      // Orders by day of week (last 90 days)
      const last90 = new Date(); last90.setDate(last90.getDate() - 90);
      const recentOrds = allOrdersAll.filter(o => new Date(o.orderDate) >= last90 && o.status !== 'CANCELLED');
      const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
      const ordByDay = Array.from({ length: 7 }, (_, i) => ({ day: dayNames[i], count: recentOrds.filter(o => new Date(o.orderDate).getDay() === i).length }));

      // Inactive companies (active companies that haven't ordered in ≥10 days)
      const tenDaysAgo = new Date(); tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      const lastOrderByCompany: Record<number, Date> = {};
      for (const o of allOrdersAll.filter(x => x.status !== 'CANCELLED')) {
        const d = new Date(o.orderDate);
        const existing = lastOrderByCompany[o.companyId];
        if (!existing || d > existing) {
          lastOrderByCompany[o.companyId] = d;
        }
      }
      const inactiveCompanies = allCompanies.filter(c => c.active).map(c => {
        const last = lastOrderByCompany[c.id];
        const daysSince = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : 9999;
        return { id: c.id, name: c.companyName, lastOrder: last ? last.toISOString().slice(0,10) : null, daysSince };
      }).filter(c => c.daysSince >= 7).sort((a, b) => b.daysSince - a.daysSince).slice(0, 15);

      // Purchase forecast (avg weekly by product, last 8 weeks)
      const eightWeeksAgo = new Date(); eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
      const recentItems = allItems.filter(i => {
        const ord = allOrdersAll.find(o => o.id === i.orderId);
        return ord && new Date(ord.orderDate) >= eightWeeksAgo && ord.status !== 'CANCELLED';
      });
      const forecastMap: Record<number, number> = {};
      for (const item of recentItems) { forecastMap[item.productId] = (forecastMap[item.productId] || 0) + item.quantity; }
      const forecast = Object.entries(forecastMap).map(([pid, total]) => {
        const pr = allProds.find(p => p.id === parseInt(pid));
        const avgWeekly = total / 8;
        return { productId: parseInt(pid), productName: pr?.name || `Produto #${pid}`, avgWeekly: Math.round(avgWeekly * 10) / 10, avgMonthly: Math.round(avgWeekly * 4.3 * 10) / 10, suggestion: Math.ceil(avgWeekly * 1.1) };
      }).sort((a, b) => b.avgWeekly - a.avgWeekly).slice(0, 15);

      // Revenue by date (last 30 days)
      const revenueByDate: Record<string, number> = {};
      const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      for (const o of allOrdersAll.filter(x => new Date(x.orderDate) >= thirtyDaysAgo && x.status !== 'CANCELLED')) {
        const dt = new Date(o.orderDate).toISOString().slice(0,10);
        revenueByDate[dt] = (revenueByDate[dt] || 0) + parseFloat(o.totalValue || '0');
      }
      const revenueTimeline = Object.entries(revenueByDate).map(([date, revenue]) => ({ date, revenue })).sort((a, b) => a.date.localeCompare(b.date));

      // Alerts
      const alerts: { type: 'ERROR' | 'WARN' | 'INFO'; message: string }[] = [];
      const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
      const prevWeekEnd = new Date(weekStart);
      const prevWeekRevenue = sum(allOrdersAll.filter(o => new Date(o.orderDate) >= prevWeekStart && new Date(o.orderDate) < prevWeekEnd));
      const thisWeekRevenue = sum(weekOrders);
      if (prevWeekRevenue > 0 && thisWeekRevenue < prevWeekRevenue * 0.8) alerts.push({ type: 'WARN', message: `Faturamento da semana atual (R$${thisWeekRevenue.toFixed(0)}) queda de ${Math.round((1 - thisWeekRevenue/prevWeekRevenue)*100)}% vs semana anterior` });
      const criticalInactive = inactiveCompanies.filter(c => c.daysSince >= 10);
      if (criticalInactive.length > 0) alerts.push({ type: 'WARN', message: `${criticalInactive.length} empresa(s) sem pedido há mais de 10 dias: ${criticalInactive.slice(0,3).map(c => c.name).join(', ')}${criticalInactive.length > 3 ? '...' : ''}` });
      if (todayOrders.filter(o => o.status !== 'CANCELLED').length === 0 && now.getDay() >= 1 && now.getDay() <= 5) alerts.push({ type: 'INFO', message: 'Nenhum pedido registrado hoje ainda' });

      res.json({
        kpis: { revenueDay, revenueWeek, revenueMonth, ordersDay: todayOrders.filter(o=>o.status!=='CANCELLED').length, ordersWeek: weekOrders.filter(o=>o.status!=='CANCELLED').length, ordersMonth: monthOrders.filter(o=>o.status!=='CANCELLED').length, avgTicketMonth },
        topCompanies,
        topProducts,
        ordByDay,
        inactiveCompanies,
        forecast,
        revenueTimeline,
        alerts,
        period,
      });
    } catch (e: any) { console.error('Executive dashboard error:', e); res.status(500).json({ message: e?.message }); }
  });
}
