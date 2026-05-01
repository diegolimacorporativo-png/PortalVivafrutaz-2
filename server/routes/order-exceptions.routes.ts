import type { Express } from "express";
import { storage } from "../services/storage.ts";

export function register(app: Express) {
  // Order Exceptions
  app.get('/api/order-exceptions', async (req, res) => {
    const exceptions = await storage.getOrderExceptions();
    res.json(exceptions);
  });

  app.post('/api/order-exceptions', async (req, res) => {
    try {
      const { companyId, reason, expiryDate, active } = req.body;
      if (!companyId || !reason) return res.status(400).json({ message: "companyId and reason required" });
      const exc = await storage.createOrderException({
        companyId: Number(companyId),
        reason,
        expiryDate: expiryDate || null,
        active: active ?? true,
      });
      res.status(201).json(exc);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.put('/api/order-exceptions/:id', async (req, res) => {
    try {
      const { reason, expiryDate, active } = req.body;
      const exc = await storage.updateOrderException(Number(req.params.id), { reason, expiryDate: expiryDate || null, active });
      res.json(exc);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.delete('/api/order-exceptions/:id', async (req, res) => {
    await storage.deleteOrderException(Number(req.params.id));
    res.status(204).end();
  });

  // Check order exception for a company (used by client-side order check)
  app.get('/api/order-exceptions/company/:companyId', async (req, res) => {
    const exc = await storage.getCompanyException(Number(req.params.companyId));
    res.json(exc || null);
  });
}
