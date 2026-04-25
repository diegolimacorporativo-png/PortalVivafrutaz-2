import type { Request, Response, NextFunction } from "express";
import { productService } from "./products.service";
import { createProductSchema, updateProductSchema, productIdParamSchema } from "./products.validation";

export class ProductController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const products = await productService.listProducts();
      res.json(products);
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = productIdParamSchema.parse(req.params);
      const product = await productService.getProduct(id);
      res.json(product);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createProductSchema.parse(req.body);
      const product = await productService.createProduct(input);
      res.status(201).json(product);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = productIdParamSchema.parse(req.params);
      const input = updateProductSchema.parse(req.body);
      const product = await productService.updateProduct(id, input);
      res.json(product);
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = productIdParamSchema.parse(req.params);
      await productService.deleteProduct(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async nextCode(_req: Request, res: Response): Promise<void> {
    try {
      const nextCode = await productService.getNextProductCode();
      res.json({ nextCode });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message });
    }
  }
}

export const productController = new ProductController();
