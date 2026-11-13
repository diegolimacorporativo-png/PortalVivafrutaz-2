import type { Request, Response } from "express";
import { productionService } from "./production.service";
import type {
  GenerateBatchBody,
  ManualBatchItemBody,
  ManualExportMappingBody,
  UpdateBatchStatusBody,
  UpdateItemCheckBody,
  ListBatchesQuery,
} from "./production.validation";
import { productionExportService, type ProductionWorkbookKind } from "./production-export.service";
import { storage } from "../../services/storage";
import { UnauthorizedError } from "../../shared/errors/AppError";

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
    const body = req.body as GenerateBatchBody;
    const batch = await productionService.generateBatch(body);
    res.status(201).json({ success: true, data: batch });
  },

  /** GET /api/production/consolidated?date=YYYY-MM-DD — global, read-only snapshot. */
  async consolidated(req: Request, res: Response) {
    const date = String(req.query.date ?? "");
    const data = await productionService.getConsolidationForDate(date);
    res.json({ success: true, data });
  },

  /** GET /api/production/batches/:id */
  async getById(req: Request, res: Response) {
    const empresaId = (req as any).empresaId as number | null;
    const id = Number((req.params as any).id);
    const batch = await productionService.getById(id, empresaId);
    res.json({ success: true, data: batch });
  },

  /** Downloads an official workbook generated only from the saved batch snapshot. */
  async exportBatch(req: Request, res: Response) {
    const id = Number((req.params as any).id);
    const kind = String((req.params as any).kind) as ProductionWorkbookKind;
    const shift = (req.query as any).shift as "morning" | "afternoon" | undefined;
    const userId = (req as any).session?.userId as number | undefined;
    const user = kind === "processed" && userId ? await storage.getUser(userId) : undefined;
    const file = await productionExportService.exportBatch(id, kind, {
      shift,
      responsibleName: user?.name,
    });
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.setHeader("Content-Length", String(file.bytes.length));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(file.bytes);
  },

  /** PATCH /api/production/batches/:id/status */
  async updateStatus(req: Request, res: Response) {
    const empresaId = (req as any).empresaId as number | null;
    const id = Number((req.params as any).id);
    const body = req.body as UpdateBatchStatusBody;
    const updated = await productionService.updateStatus(
      id,
      empresaId,
      body.status,
      body.notes,
    );
    res.json({ success: true, data: updated });
  },

  /** PATCH /api/production/batch-items/:itemId/check */
  async updateItemCheck(req: Request, res: Response) {
    const empresaId = (req as any).empresaId as number | null;
    const itemId = Number((req.params as any).itemId);
    const body = req.body as UpdateItemCheckBody;
    const updated = await productionService.updateItemCheck(
      itemId,
      empresaId,
      body.checkedQuantity,
      body.notes,
    );
    res.json({ success: true, data: updated });
  },

  /** POST /api/production/batches/:id/manual-items — production-only addition, never an order mutation. */
  async addManualBatchItem(req: Request, res: Response) {
    const id = Number((req.params as any).id);
    const body = req.body as ManualBatchItemBody;
    const userId = Number((req as any).session?.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new UnauthorizedError();
    const item = await productionService.addManualBatchItem(id, body, userId);
    res.status(201).json({ success: true, data: item });
  },

  /** PATCH /api/production/batches/:id/manual-export-mapping — audited mapping override for one source item. */
  async updateManualExportMapping(req: Request, res: Response) {
    const id = Number((req.params as any).id);
    const body = req.body as ManualExportMappingBody;
    const userId = Number((req as any).session?.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new UnauthorizedError();
    const item = await productionService.updateManualExportMapping(id, body, userId);
    res.json({ success: true, data: item });
  },

  /** DELETE /api/production/batches/:id */
  async deleteBatch(req: Request, res: Response) {
    const empresaId = (req as any).empresaId as number | null;
    const id = Number((req.params as any).id);
    await productionService.deleteBatch(id, empresaId);
    res.status(204).send();
  },
};
