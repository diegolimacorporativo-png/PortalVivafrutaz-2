import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { api } from "@shared/routes";
import { z } from "zod";

export function register(app: Express) {
  // Product Prices
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

  app.post(api.productPrices.create.path, async (req, res) => {
    try {
      // Use coercion for numbers coming from form inputs if needed
      const bodySchema = api.productPrices.create.input.extend({
        productId: z.coerce.number(),
        priceGroupId: z.coerce.number(),
        price: z.string() // numeric handles strings in pg, or convert to string
      });
      const input = bodySchema.parse(req.body);
      const price = await storage.createProductPrice(input as any);
      res.status(201).json(price);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.put(api.productPrices.update.path, async (req, res) => {
    try {
      const bodySchema = api.productPrices.update.input.extend({
        productId: z.coerce.number().optional(),
        priceGroupId: z.coerce.number().optional(),
        price: z.string().optional()
      });
      const input = bodySchema.parse(req.body);
      const price = await storage.updateProductPrice(Number(req.params.id), input as any);
      res.json(price);
    } catch (err) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.delete(api.productPrices.delete.path, async (req, res) => {
    await storage.deleteProductPrice(Number(req.params.id));
    res.status(204).end();
  });
}
