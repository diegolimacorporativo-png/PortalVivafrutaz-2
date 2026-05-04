import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { api } from "@shared/routes";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import { auditLog } from "../utils/auditLogger";
import { z } from "zod";

const WRITE_ROLES = ["ADMIN", "DIRECTOR", "MASTER"];

export function register(app: Express) {
  app.get(api.productPrices.list.path, async (req, res) => {
    try {
      const prices = await storage.getProductPrices();
      res.json(prices);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get(api.productPrices.byProduct.path, async (req, res) => {
    const prices = await storage.getProductPricesByProductId(Number(req.params.productId));
    res.json(prices);
  });

  app.post(api.productPrices.create.path, requireAuth, requireRole(WRITE_ROLES), async (req: any, res) => {
    try {
      const bodySchema = api.productPrices.create.input.extend({
        productId: z.coerce.number(),
        priceGroupId: z.coerce.number(),
        price: z.string()
      });
      const input = bodySchema.parse(req.body);
      auditLog("CREATE_PRODUCT_PRICE", {
        userId: req.session?.userId,
        role: req.session?.userRole,
        entity: "product_price",
        details: { productId: input.productId, priceGroupId: input.priceGroupId, price: input.price },
      });
      const price = await storage.createProductPrice(input as any);
      res.status(201).json(price);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.put(api.productPrices.update.path, requireAuth, requireRole(WRITE_ROLES), async (req: any, res) => {
    try {
      const bodySchema = api.productPrices.update.input.extend({
        productId: z.coerce.number().optional(),
        priceGroupId: z.coerce.number().optional(),
        price: z.string().optional()
      });
      const input = bodySchema.parse(req.body);
      auditLog("UPDATE_PRODUCT_PRICE", {
        userId: req.session?.userId,
        role: req.session?.userRole,
        entity: "product_price",
        entityId: Number(req.params.id),
        details: input,
      });
      const price = await storage.updateProductPrice(Number(req.params.id), input as any);
      res.json(price);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.delete(api.productPrices.delete.path, requireAuth, requireRole(WRITE_ROLES), async (req: any, res) => {
    const id = Number(req.params.id);
    auditLog("DELETE_PRODUCT_PRICE", {
      userId: req.session?.userId,
      role: req.session?.userRole,
      entity: "product_price",
      entityId: id,
    });
    await storage.deleteProductPrice(id);
    res.status(204).end();
  });
}
