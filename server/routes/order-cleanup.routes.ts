import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import { requireRole } from "../core/http/requireAuth";
import { resolveTenant } from "../core/tenant/context";
// MT-3B M4 — crossTenant() is the official audit marker for intentional global reads.
import { crossTenant } from "../core/tenant/scope";
import { logSecurityEvent } from "../core/security/securityLogger";

export function register(app: Express) {
  app.get('/api/admin/order-cleanup-check', requireAuthCore, requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]), async (req: any, res) => {
    try {
      resolveTenant(req);
      logSecurityEvent({ type: "ADMIN_ORDER_CLEANUP_CHECK", userId: req.session?.userId, path: req.originalUrl, requestId: req.requestId });
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      // MT-3B M4 — intentional cross-tenant read: admin cleanup operates across all tenants.
      void crossTenant();
      const allOrders = await storage.getOrders();
      const old = allOrders.filter(o => new Date(o.orderDate) < twoMonthsAgo);
      res.json({ count: old.length, oldestDate: old[old.length - 1]?.orderDate || null });
    } catch { res.status(500).json({ message: "Erro interno" }); }
  });

  app.delete('/api/admin/order-cleanup', requireAuthCore, async (req, res) => {
    try {
      resolveTenant(req);
      logSecurityEvent({ type: "ADMIN_ORDER_CLEANUP_DELETE", userId: req.session?.userId, path: req.originalUrl, requestId: req.requestId });
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      // MT-3B M4 — intentional cross-tenant read: admin cleanup operates across all tenants.
      void crossTenant();
      const allOrders = await storage.getOrders();
      const oldOrders = allOrders.filter(o => new Date(o.orderDate) < twoMonthsAgo);
      for (const o of oldOrders) {
        await storage.deleteOrder(o.id);
      }
      res.json({ deleted: oldOrders.length });
    } catch { res.status(500).json({ message: "Erro interno" }); }
  });
}
