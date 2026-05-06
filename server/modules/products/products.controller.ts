import type { Request, Response, NextFunction } from "express";
import { productService } from "./products.service";
import { createProductSchema, updateProductSchema, productIdParamSchema } from "./products.validation";

interface SessionLike {
  userId?: number;
}

const ALLOWED_SUB_CATEGORY_ROLES = ['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR', 'PURCHASE_MANAGER'];

function getSessionUserId(req: Request): number | null {
  const session = (req as Request & { session?: SessionLike }).session;
  return session?.userId ?? null;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return forwardedStr?.split(',')[0] || req.socket.remoteAddress || '';
}

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

  async create(req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      const input = createProductSchema.parse(req.body);
      if (input.basePrice !== null && input.basePrice !== undefined && input.basePrice !== "") {
        const price = Number(input.basePrice);
        if (!Number.isFinite(price) || price < 0) {
          res.status(400).json({ message: "Preço base é obrigatório e deve ser maior ou igual a zero" });
          return;
        }
      }
      const product = await productService.createProduct(input);
      res.status(201).json(product);
    } catch (err) {
      console.warn(`[${req.requestId}] [products.controller] create failed`, err);
      res.status(400).json({ message: "Bad request" });
    }
  }

  async update(req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      const id = Number(req.params.id);
      if (!id) {
        res.status(400).json({ message: 'Invalid id' });
        return;
      }
      const input = updateProductSchema.parse(req.body);
      if (input.basePrice !== null && input.basePrice !== undefined && input.basePrice !== "") {
        const price = Number(input.basePrice);
        if (!Number.isFinite(price) || price < 0) {
          res.status(400).json({ message: "Preço base é obrigatório e deve ser maior ou igual a zero" });
          return;
        }
      }
      const product = await productService.updateProduct(id, input);
      res.json(product);
    } catch (err) {
      console.warn(`[${req.requestId}] [products.controller] update failed`, err);
      res.status(400).json({ message: "Bad request" });
    }
  }

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number(req.params.id);
      if (!id) {
        res.status(400).json({ message: 'Invalid id' });
        return;
      }
      await productService.deleteProduct(id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  async nextCode(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const nextCode = await productService.getNextProductCode();
      res.json({ nextCode });
    } catch (err) {
      next(err);
    }
  }

  async safraAlerts(req: Request, res: Response): Promise<void> {
    try {
      const alerts = await productService.getSafraAlerts();
      res.json(alerts);
    } catch (err) {
      console.warn(`[${req.requestId}] [products.controller] safraAlerts failed`, err);
      res.status(500).json({ message: "Erro interno" });
    }
  }

  async checkCode(req: Request, res: Response): Promise<void> {
    try {
      const code = String(req.query.code || '').trim();
      const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;
      const result = await productService.checkProductCode(code, excludeId);
      if (!code) {
        res.json({ exists: false });
        return;
      }
      res.json(result);
    } catch (e) {
      console.warn(`[${req.requestId}] [products.controller] checkCode failed`, e);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message });
    }
  }

  async checkDuplicate(req: Request, res: Response): Promise<void> {
    try {
      const name = String(req.query.name || '').trim().toLowerCase();
      const code = String(req.query.code || '').trim();
      const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;
      const result = await productService.checkProductDuplicate(name, code, excludeId);
      if (!name) {
        res.json({ exists: false });
        return;
      }
      res.json(result);
    } catch (e) {
      console.warn(`[${req.requestId}] [products.controller] checkDuplicate failed`, e);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message });
    }
  }

  async priceAlerts(req: Request, res: Response): Promise<void> {
    try {
      const alerts = await productService.getPriceAlerts();
      res.json(alerts);
    } catch (e) {
      console.warn(`[${req.requestId}] [products.controller] priceAlerts failed`, e);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message });
    }
  }

  async setOutOfSeason(req: Request, res: Response): Promise<void> {
    try {
      const id = Number(req.params.id);
      if (!id) {
        res.status(400).json({ message: 'Invalid id' });
        return;
      }
      const { outOfSeason } = req.body as { outOfSeason?: unknown };
      if (typeof outOfSeason !== 'boolean') {
        res.status(400).json({ message: 'outOfSeason deve ser boolean' });
        return;
      }
      const userId = getSessionUserId(req);
      const ip = getClientIp(req);
      const product = await productService.toggleOutOfSeason(id, outOfSeason, userId, ip);
      res.json(product);
    } catch (err) {
      console.warn(`[${req.requestId}] [products.controller] setOutOfSeason failed`, err);
      res.status(500).json({ message: 'Erro interno' });
    }
  }

  async listSubCategories(req: Request, res: Response): Promise<void> {
    try {
      const productId = Number(req.params.productId);
      if (!productId) {
        res.status(400).json({ message: 'Invalid id' });
        return;
      }
      const rows = await productService.listSubCategoriesForProduct(productId);
      res.json(rows);
    } catch (err) {
      console.warn(`[${req.requestId}] [products.controller] listSubCategories failed`, err);
      res.status(500).json({ message: 'Erro interno' });
    }
  }

  async createSubCategory(req: Request, res: Response): Promise<void> {
    try {
      const userId = getSessionUserId(req);
      if (!userId) {
        res.status(401).json({ message: 'Não autenticado' });
        return;
      }
      const actor = await productService.getActor(userId);
      if (!actor || !ALLOWED_SUB_CATEGORY_ROLES.includes(actor.role)) {
        res.status(403).json({ message: 'Sem permissão' });
        return;
      }
      const productId = Number(req.params.productId);
      if (!productId) {
        res.status(400).json({ message: 'Invalid id' });
        return;
      }
      const { categoryName, price, active } = req.body as {
        categoryName?: string;
        price?: string | number;
        active?: boolean;
      };
      if (!categoryName || !price) {
        res.status(400).json({ message: 'categoryName e price são obrigatórios' });
        return;
      }
      const row = await productService.addSubCategory(productId, { categoryName, price, active });
      res.status(201).json(row);
    } catch (e) {
      console.warn(`[${req.requestId}] [products.controller] createSubCategory failed`, e);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message });
    }
  }

  async updateSubCategory(req: Request, res: Response): Promise<void> {
    try {
      const userId = getSessionUserId(req);
      if (!userId) {
        res.status(401).json({ message: 'Não autenticado' });
        return;
      }
      const actor = await productService.getActor(userId);
      if (!actor || !ALLOWED_SUB_CATEGORY_ROLES.includes(actor.role)) {
        res.status(403).json({ message: 'Sem permissão' });
        return;
      }
      const id = Number(req.params.id);
      if (!id) {
        res.status(400).json({ message: 'Invalid id' });
        return;
      }
      const { categoryName, price, active } = req.body as {
        categoryName?: string;
        price?: string | number;
        active?: boolean;
      };
      const row = await productService.editSubCategory(id, { categoryName, price, active });
      res.json(row);
    } catch (e) {
      console.warn(`[${req.requestId}] [products.controller] updateSubCategory failed`, e);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message });
    }
  }

  async deleteSubCategory(req: Request, res: Response): Promise<void> {
    try {
      const userId = getSessionUserId(req);
      if (!userId) {
        res.status(401).json({ message: 'Não autenticado' });
        return;
      }
      const actor = await productService.getActor(userId);
      if (!actor || !ALLOWED_SUB_CATEGORY_ROLES.includes(actor.role)) {
        res.status(403).json({ message: 'Sem permissão' });
        return;
      }
      const id = Number(req.params.id);
      if (!id) {
        res.status(400).json({ message: 'Invalid id' });
        return;
      }
      await productService.removeSubCategory(id);
      res.json({ ok: true });
    } catch (e) {
      console.warn(`[${req.requestId}] [products.controller] deleteSubCategory failed`, e);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message });
    }
  }

  async deleteAllSubCategoriesForProduct(req: Request, res: Response): Promise<void> {
    try {
      const userId = getSessionUserId(req);
      if (!userId) {
        res.status(401).json({ message: 'Não autenticado' });
        return;
      }
      const actor = await productService.getActor(userId);
      if (!actor || !ALLOWED_SUB_CATEGORY_ROLES.includes(actor.role)) {
        res.status(403).json({ message: 'Sem permissão' });
        return;
      }
      const productId = Number(req.params.productId);
      if (!productId) {
        res.status(400).json({ message: 'Invalid id' });
        return;
      }
      await productService.removeAllSubCategoriesForProduct(productId);
      res.json({ ok: true });
    } catch (e) {
      console.warn(`[${req.requestId}] [products.controller] deleteAllSubCategoriesForProduct failed`, e);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message });
    }
  }

  async listCategories(_req: Request, res: Response): Promise<void> {
    const cats = await productService.listCategories();
    res.json(cats);
  }

  async createCategory(req: Request, res: Response): Promise<void> {
    try {
      const { name, description, active } = req.body as {
        name?: string;
        description?: string | null;
        active?: boolean;
      };
      if (!name) {
        res.status(400).json({ message: "name required" });
        return;
      }
      const cat = await productService.createCategory({
        name,
        description: description || null,
        active: active ?? true,
      });
      res.status(201).json(cat);
    } catch (err: any) {
      if (err?.code === '23505') {
        res.status(409).json({ message: "Categoria já existe" });
        return;
      }
      console.warn(`[${req.requestId}] [products.controller] createCategory failed`, err);
      res.status(400).json({ message: "Bad request" });
    }
  }

  async updateCategory(req: Request, res: Response): Promise<void> {
    try {
      const { name, description, active } = req.body as {
        name?: string;
        description?: string | null;
        active?: boolean;
      };
      const cat = await productService.updateCategory(Number(req.params.id), {
        name,
        description,
        active,
      });
      res.json(cat);
    } catch (err: any) {
      if (err?.code === '23505') {
        res.status(409).json({ message: "Categoria já existe" });
        return;
      }
      console.warn(`[${req.requestId}] [products.controller] updateCategory failed`, err);
      res.status(400).json({ message: "Bad request" });
    }
  }

  async deleteCategory(req: Request, res: Response): Promise<void> {
    await productService.deleteCategory(Number(req.params.id));
    res.status(204).end();
  }
}

export const productController = new ProductController();
