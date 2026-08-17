import { Router } from "express";
import { asyncHandler } from "../../shared/utils/asyncHandler";
import { validate } from "../../shared/middlewares/validate";
import { tenantContext } from "../../middleware/tenant";
import { requireAuth, requireRole } from "../../core/http/requireAuth";
import { productionController } from "./production.controller";
import {
  generateBatchBodySchema,
  updateBatchStatusBodySchema,
  updateItemCheckBodySchema,
  listBatchesQuerySchema,
  batchIdParamSchema,
} from "./production.validation";

export const productionRouter = Router();

const PRODUCTION_ROLES = [
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
  "OPERATIONS_MANAGER",
  "PURCHASE_MANAGER",
  "LOGISTICS",
];

// Production is an admin-only module. tenantContext then resolves the
// authoritative tenant from the authenticated session.
productionRouter.use(
  requireAuth,
  requireRole(PRODUCTION_ROLES),
  tenantContext,
);

// ─── Batch routes ──────────────────────────────────────────────

// GET  /api/production/batches          — list batches
productionRouter.get(
  "/batches",
  validate(listBatchesQuerySchema, "query"),
  asyncHandler(productionController.list),
);

// POST /api/production/batches/generate — generate batch from orders
productionRouter.post(
  "/batches/generate",
  validate(generateBatchBodySchema, "body"),
  asyncHandler(productionController.generate),
);

// GET  /api/production/batches/:id      — get batch + items
productionRouter.get(
  "/batches/:id",
  validate(batchIdParamSchema, "params"),
  asyncHandler(productionController.getById),
);

// PATCH /api/production/batches/:id/status — transition status
productionRouter.patch(
  "/batches/:id/status",
  validate(batchIdParamSchema, "params"),
  validate(updateBatchStatusBodySchema, "body"),
  asyncHandler(productionController.updateStatus),
);

// DELETE /api/production/batches/:id    — delete batch (admin)
productionRouter.delete(
  "/batches/:id",
  validate(batchIdParamSchema, "params"),
  asyncHandler(productionController.deleteBatch),
);

// ─── Item routes ───────────────────────────────────────────────

// PATCH /api/production/batch-items/:itemId/check — update checked quantity
productionRouter.patch(
  "/batch-items/:itemId/check",
  asyncHandler(productionController.updateItemCheck),
);
