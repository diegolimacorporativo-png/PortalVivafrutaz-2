import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { tenantContext } from "../middleware/tenant";

export function register(app: Express) {
  app.get('/api/purchase-planning/forecast', tenantContext, async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    try {
      const [allOrders, allProds] = await Promise.all([storage.getOrders(), storage.getProducts()]);
      const prodById = new Map(allProds.map(p => [p.id, p]));
      const eightWeeksAgo = new Date(); eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
      const recentOrders = allOrders.filter(o => o.status !== 'CANCELLED' && new Date(o.deliveryDate) >= eightWeeksAgo);

      // Aggregate by product name, per week
      const weeklyMap: Record<string, Record<string, number>> = {}; // productName -> weekKey -> qty
      for (const order of recentOrders) {
        const orderWithItems = await storage.getOrder(order.id);
        if (!orderWithItems) continue;
        const items = orderWithItems.items;
        const delivDate = new Date(order.deliveryDate);
        const weekKey = `${delivDate.getFullYear()}-W${Math.ceil((delivDate.getDate() + new Date(delivDate.getFullYear(), delivDate.getMonth(), 1).getDay()) / 7)}`;
        for (const item of items) {
          const prod = prodById.get(item.productId);
          const name = prod?.name || `Produto #${item.productId}`;
          if (!weeklyMap[name]) weeklyMap[name] = {};
          weeklyMap[name][weekKey] = (weeklyMap[name][weekKey] || 0) + Number(item.quantity || 0);
        }
      }

      const forecast = Object.entries(weeklyMap).map(([productName, weeks]) => {
        const weekValues = Object.values(weeks);
        const totalWeeks = 8;
        const avgWeekly = weekValues.reduce((s, v) => s + v, 0) / totalWeeks;
        const recentWeeks = weekValues.slice(-2);
        const recentAvg = recentWeeks.length ? recentWeeks.reduce((s, v) => s + v, 0) / recentWeeks.length : avgWeekly;
        const trend: 'up' | 'down' | 'stable' = recentAvg > avgWeekly * 1.1 ? 'up' : recentAvg < avgWeekly * 0.9 ? 'down' : 'stable';
        return {
          productName, avgWeekly: Math.round(avgWeekly * 10) / 10,
          suggestion: Math.ceil(avgWeekly * 1.15), weeksActive: weekValues.filter(v => v > 0).length,
          trend, recentAvg: Math.round(recentAvg * 10) / 10,
        };
      }).filter(f => f.avgWeekly > 0).sort((a, b) => b.avgWeekly - a.avgWeekly);

      res.json({ forecast, analyzedWeeks: 8, generatedAt: new Date().toISOString() });
    } catch (e: any) {
      console.error('Forecast error:', e);
      res.status(500).json({ message: e.message });
    }
  });

  app.get('/api/purchase-planning', tenantContext, async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    try {
      // Accept startDate (YYYY-MM-DD) as primary param; auto-compute Mon–Fri range
      const { startDate: rawStart, categoryFilter, sourceFilter } = req.query as Record<string, string>;
      // Compute start (Monday) and end (Friday) of the selected week
      let startDate = rawStart;
      if (!startDate) {
        const today = new Date();
        const day = today.getDay() || 7; // ISO: Mon=1..Sun=7
        const mon = new Date(today); mon.setDate(today.getDate() - (day - 1));
        startDate = mon.toISOString().substring(0, 10);
      }
      const startD = new Date(startDate + 'T12:00:00');
      const endD = new Date(startD); endD.setDate(startD.getDate() + 4);
      const endDate = endD.toISOString().substring(0, 10);
      const weekRef = startDate; // use startDate as weekRef for plan statuses

      const [allOrders, allProducts, allCompanies] = await Promise.all([
        storage.getOrders(),
        storage.getProducts(),
        storage.getCompanies(),
      ]);
      const productById = new Map(allProducts.map(p => [p.id, p]));
      const companyById = new Map(allCompanies.map(c => [c.id, c]));

      const filtered = allOrders.filter(o => {
        if (['CANCELLED'].includes(o.status)) return false;
        const d = new Date(o.deliveryDate).toISOString().substring(0, 10);
        if (d < startDate) return false;
        if (d > endDate) return false;
        return true;
      });

      // Aggregate items by product
      type PlanEntry = {
        productId: number | null; productName: string; totalQty: number; unit: string;
        category?: string; productType?: string; source: 'regular' | 'special';
        companies: { companyId: number; companyName: string; quantity: number; deliveryDate: string; orderId: number; orderCode: string }[];
      };
      const productMap: Map<string, PlanEntry> = new Map();

      // Regular order items (only if sourceFilter allows)
      if (!sourceFilter || sourceFilter === 'all' || sourceFilter === 'regular') {
        if (!categoryFilter || categoryFilter === 'all') { // regular items have no category
          for (const order of filtered) {
            const orderWithItems = await storage.getOrder(order.id);
            if (!orderWithItems) continue;
            for (const item of orderWithItems.items) {
              const prod = productById.get(item.productId);
              const productName = prod?.name || `Produto #${item.productId}`;
              const unit = prod?.unit || 'un';
              const key = `reg__${productName}`;
              if (!productMap.has(key)) {
                productMap.set(key, { productId: item.productId, productName, totalQty: 0, unit, source: 'regular', companies: [] });
              }
              const entry = productMap.get(key)!;
              entry.totalQty += Number(item.quantity || 0);
              const companyName = companyById.get(order.companyId)?.companyName || `Empresa #${order.companyId}`;
              entry.companies.push({
                companyId: order.companyId, companyName,
                quantity: Number(item.quantity || 0),
                deliveryDate: new Date(order.deliveryDate).toISOString().substring(0, 10),
                orderId: order.id,
                orderCode: order.orderCode || `VF-${order.id}`,
              });
            }
          }
        }
      }

      // Approved special order items
      if (!sourceFilter || sourceFilter === 'all' || sourceFilter === 'special') {
        const allSpecial = await storage.getSpecialOrderRequests();
        const approvedSpecial = allSpecial.filter(s => s.status === 'APPROVED');
        for (const sr of approvedSpecial) {
          const srItems: any[] = Array.isArray((sr as any).items) ? (sr as any).items : [];
          const company = await storage.getCompany(sr.companyId);
          const companyName = company?.companyName || `Empresa #${sr.companyId}`;
          const delivDate = (sr as any).estimatedDeliveryDate || sr.requestedDate || sr.requestedDay || 'A definir';

          for (const si of srItems) {
            if (categoryFilter && categoryFilter !== 'all' && si.category !== categoryFilter) continue;
            const productType = si.productType || 'catalog';
            const key = `spec__${si.productName}__${si.category || ''}`;
            if (!productMap.has(key)) {
              productMap.set(key, {
                productId: null, productName: si.productName, totalQty: 0, unit: 'un',
                category: si.category, productType, source: 'special', companies: [],
              });
            }
            const entry = productMap.get(key)!;
            // Parse quantity safely — special order qty may be a string like "2kg"
            const rawQty = si.approvedQuantity ?? si.quantity ?? 0;
            const qty = parseFloat(String(rawQty).replace(/[^0-9.]/g, '')) || 0;
            entry.totalQty += qty;
            entry.companies.push({
              companyId: sr.companyId, companyName, quantity: qty,
              deliveryDate: delivDate, orderId: sr.id, orderCode: `PP-${sr.id}`,
            });
          }
        }
      }

      // Contract scope demand (contratual companies) — shows expected weekly demand
      if (!sourceFilter || sourceFilter === 'all' || sourceFilter === 'scope') {
        const DAY_OFFSET: Record<string, number> = {
          'Segunda-feira': 0, 'Terça-feira': 1, 'Quarta-feira': 2,
          'Quinta-feira': 3, 'Sexta-feira': 4,
        };
        const contratualCompanies = allCompanies.filter(c => (c as any).clientType === 'contratual');
        for (const c of contratualCompanies) {
          const companyScopes = await storage.getContractScopes(c.id);
          for (const scope of companyScopes) {
            const prod = productById.get(scope.productId);
            const productName = prod?.name || `Produto #${scope.productId}`;
            const unit = prod?.unit || 'un';
            const offset = DAY_OFFSET[scope.dayOfWeek];
            if (offset === undefined) continue;
            const deliveryDate = new Date(startD);
            deliveryDate.setDate(startD.getDate() + offset);
            const delivDateStr = deliveryDate.toISOString().substring(0, 10);
            if (categoryFilter && categoryFilter !== 'all') continue; // scopes don't have category filter here
            const key = `scope__${productName}`;
            if (!productMap.has(key)) {
              productMap.set(key, { productId: scope.productId, productName, totalQty: 0, unit, source: 'scope' as any, companies: [] });
            }
            const entry = productMap.get(key)!;
            const qty = Number(scope.quantity) || 0;
            entry.totalQty += qty;
            entry.companies.push({
              companyId: c.id, companyName: c.companyName, quantity: qty,
              deliveryDate: delivDateStr, orderId: 0, orderCode: `SC-${c.id}`,
            });
          }
        }
      }

      const result = Array.from(productMap.values()).sort((a, b) => b.totalQty - a.totalQty);

      // Attach plan statuses
      const statuses = await storage.getPurchasePlanStatuses(weekRef);
      const statusMap = new Map(statuses.map(s => [s.productName, s]));
      const enriched = result.map(p => ({ ...p, planStatus: statusMap.get(p.productName) || null }));

      // Group by day for day-by-day view
      const DAY_NAMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
      const byDay: Record<string, { date: string; dayName: string; shortDate: string; items: typeof enriched }> = {};
      for (const p of enriched) {
        for (const c of p.companies) {
          const d = c.deliveryDate;
          if (!byDay[d]) {
            const dt = new Date(d + 'T12:00:00');
            byDay[d] = {
              date: d, dayName: DAY_NAMES[dt.getDay()] ?? '',
              shortDate: dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
              items: [],
            };
          }
          // Check if this product already in day
          let dayItem = byDay[d]!.items.find(i => i.productName === p.productName && i.source === p.source);
          if (!dayItem) {
            dayItem = { ...p, totalQty: 0, companies: [], planStatus: p.planStatus };
            byDay[d]!.items.push(dayItem);
          }
          dayItem.totalQty += c.quantity;
          dayItem.companies.push(c);
        }
      }
      const dayGroups = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));

      res.json({ items: enriched, byDay: dayGroups, totalOrders: filtered.length, period: { startDate, endDate }, weekRef });
    } catch (e: any) {
      console.error('Purchase planning error:', e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post('/api/purchase-planning/status', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const user = await storage.getUser(session.userId);
    try {
      const rec = await storage.upsertPurchasePlanStatus({ ...req.body, updatedBy: user?.name || 'Sistema' });
      res.json(rec);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.get('/api/purchase-planning/statuses', async (req, res) => {
    const session = req.session as any;
    if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
    const weekRef = req.query.weekRef as string;
    if (!weekRef) return res.status(400).json({ message: 'weekRef required' });
    const statuses = await storage.getPurchasePlanStatuses(weekRef);
    res.json(statuses);
  });
}
