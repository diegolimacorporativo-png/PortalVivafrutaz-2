import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { api } from "@shared/routes";

export function register(app: Express) {
  // Order Windows
  app.get(api.orderWindows.list.path, async (req, res) => {
    const windows = await storage.getOrderWindows();
    res.json(windows);
  });

  app.get(api.orderWindows.active.path, async (req, res) => {
    // Check global orders enabled setting first
    const ordersEnabled = await storage.getSetting('orders_enabled');
    if (ordersEnabled === 'false') {
      return res.json(null);
    }

    const window = await storage.getActiveOrderWindow();
    if (!window) return res.json(null);

    // Check Thursday 12:00 deadline unless forceOpen is set
    if (!window.forceOpen) {
      const now = new Date();
      const day = now.getDay(); // 0=Sun, 1=Mon, ..., 4=Thu, 5=Fri, 6=Sat
      const hour = now.getHours();
      // Block if it's Thursday after 12:00, or Friday/Saturday/Sunday
      if ((day === 4 && hour >= 12) || day === 5 || day === 6 || day === 0) {
        return res.json({ ...window, closedByDeadline: true });
      }
    }

    res.json(window);
  });

  app.post(api.orderWindows.create.path, async (req, res) => {
    try {
      const { weekReference, orderOpenDate, orderCloseDate, deliveryStartDate, deliveryEndDate, active, forceOpen } = req.body;
      if (!weekReference || !orderOpenDate || !orderCloseDate || !deliveryStartDate || !deliveryEndDate) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      const window = await storage.createOrderWindow({
        weekReference,
        orderOpenDate,
        orderCloseDate,
        deliveryStartDate,
        deliveryEndDate,
        active: active ?? true,
        forceOpen: forceOpen ?? false,
      } as any);
      res.status(201).json(window);
    } catch (err) {
      console.error("Create order window error:", err);
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.put(api.orderWindows.update.path, async (req, res) => {
    try {
      const { weekReference, orderOpenDate, orderCloseDate, deliveryStartDate, deliveryEndDate, active, forceOpen } = req.body;
      const updates: any = {};
      if (weekReference !== undefined) updates.weekReference = weekReference;
      if (orderOpenDate !== undefined) updates.orderOpenDate = orderOpenDate;
      if (orderCloseDate !== undefined) updates.orderCloseDate = orderCloseDate;
      if (deliveryStartDate !== undefined) updates.deliveryStartDate = deliveryStartDate;
      if (deliveryEndDate !== undefined) updates.deliveryEndDate = deliveryEndDate;
      if (active !== undefined) updates.active = active;
      if (forceOpen !== undefined) updates.forceOpen = forceOpen;
      const window = await storage.updateOrderWindow(Number(req.params.id), updates);
      res.json(window);
    } catch (err) {
      console.error("Update order window error:", err);
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.delete(api.orderWindows.delete.path, async (req, res) => {
    await storage.deleteOrderWindow(Number(req.params.id));
    res.status(204).end();
  });
}
