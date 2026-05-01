import type { Express } from "express";
import { storage } from "../services/storage.ts";

export function register(app: Express) {
  // ─── Order Cleanup Check (Module 5) ────────────────────────────
  app.get('/api/admin/order-cleanup-check', async (req, res) => {
    try {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      const allOrders = await storage.getOrders();
      const old = allOrders.filter(o => new Date(o.orderDate) < twoMonthsAgo);
      res.json({ count: old.length, oldestDate: old[old.length - 1]?.orderDate || null });
    } catch { res.status(500).json({ message: "Erro interno" }); }
  });

  app.delete('/api/admin/order-cleanup', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    try {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      const allOrders = await storage.getOrders();
      const oldOrders = allOrders.filter(o => new Date(o.orderDate) < twoMonthsAgo);
      for (const o of oldOrders) {
        await storage.deleteOrder(o.id);
      }
      res.json({ deleted: oldOrders.length });
    } catch { res.status(500).json({ message: "Erro interno" }); }
  });
}
