import type { Request, Response } from "express";
import { productionService } from "./production.service";
import type {
  GenerateBatchBody,
  UpdateBatchStatusBody,
  UpdateItemCheckBody,
  ListBatchesQuery,
} from "./production.validation";

export const productionController = {
  /** GET /api/production/batches */
  async list(req: Request, res: Response) {
    const empresaId = (req as any).empresaId as number | null;
    const q = req.query as unknown as ListBatchesQuery;
    const batches = await productionService.list(empresaId, {
      status: Array.isArray(q.status) ? q.status[0] : q.status,
      date: Array.isArray(q.date) ? q.date[0] : q.date,
      page: q.page,
      limit: q.limit,
    });
    res.json({ success: true, data: batches });
  },

  /** POST /api/production/batches/generate */
  async generate(req: Request, res: Response) {
    const empresaId = (req as any).empresaId as number | null;
    const body = req.body as GenerateBatchBody;
    const batch = await productionService.generateBatch(empresaId, body);
    res.status(201).json({ success: true, data: batch });
  },

  /** GET /api/production/batches/:id */
  async getById(req: Request, res: Response) {
    const id = Number((req.params as any).id);
    const batch = await productionService.getById(id);
    res.json({ success: true, data: batch });
  },

  /** PATCH /api/production/batches/:id/status */
  async updateStatus(req: Request, res: Response) {
    const id = Number((req.params as any).id);
    const body = req.body as UpdateBatchStatusBody;
    const updated = await productionService.updateStatus(id, body.status, body.notes);
    res.json({ success: true, data: updated });
  },

  /** PATCH /api/production/batch-items/:itemId/check */
  async updateItemCheck(req: Request, res: Response) {
    const itemId = Number((req.params as any).itemId);
    const body = req.body as UpdateItemCheckBody;
    const updated = await productionService.updateItemCheck(
      itemId,
      body.checkedQuantity,
      body.notes,
    );
    res.json({ success: true, data: updated });
  },

  /** DELETE /api/production/batches/:id */
  async deleteBatch(req: Request, res: Response) {
    const id = Number((req.params as any).id);
    await productionService.deleteBatch(id);
    res.status(204).send();
  },
};
