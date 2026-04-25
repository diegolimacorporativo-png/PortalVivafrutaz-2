import { Router } from "express";
import { asyncHandler } from "../../shared/utils/asyncHandler";
import { validate } from "../../shared/middlewares/validate";
import { tenantContext } from "../../middleware/tenant";
import { ordersControllerV2 } from "./orders.controller.v2";
import {
  bulkDeleteBodySchema,
  createDanfeLogBodySchema,
  createOrderBodySchema,
  createWithDeliveryBodySchema,
  deleteOrderBodySchema,
  exportQuerySchema,
  finalizeEditBodySchema,
  idParamSchema,
  listOrdersQuerySchema,
  requestReopenBodySchema,
  substituteItemBodySchema,
  transitionBodySchema,
  updateFiscalBodySchema,
  updateOrderBodySchema,
  updateOrderItemsBodySchema,
} from "./orders.validation";

/**
 * Orders v2 router — /api/v2/orders
 *
 * Same middleware chain and validation schemas as v1.
 * The ONLY difference is the controller: OrdersControllerV2 guarantees that
 * every response uses a helper from `shared/utils/apiResponse`:
 *   ok()        → 200 { success: true, data: T }
 *   created()   → 201 { success: true, data: T }
 *   noContent() → 204 (empty body — DELETE endpoints)
 *   fail()      → 4xx { success: false, error }
 *
 * Business logic is untouched — same service, same repository.
 *
 * v1 is preserved unmodified at /api/orders (legacy) and /api/v1/orders.
 *
 * REGISTRATION ORDER NOTE: literal sibling paths (export, reopen-requests,
 * bulk, create-with-delivery) are declared BEFORE /:id wildcards so Express
 * picks the literal first. Identical to the v1 router ordering.
 */
const router = Router();
router.use(tenantContext);

// ── GETs (literals BEFORE /:id) ────────────────────────────────────────
router.get(
  "/",
  validate(listOrdersQuerySchema, "query"),
  asyncHandler(ordersControllerV2.list),
);

router.get(
  "/export",
  validate(exportQuerySchema, "query"),
  asyncHandler(ordersControllerV2.export),
);

router.get(
  "/reopen-requests",
  asyncHandler(ordersControllerV2.reopenRequests),
);

router.get(
  "/:id",
  ordersControllerV2.ensureNumericId,
  validate(idParamSchema, "params"),
  asyncHandler(ordersControllerV2.get),
);

router.get(
  "/:id/danfe-logs",
  validate(idParamSchema, "params"),
  asyncHandler(ordersControllerV2.listDanfeLogs),
);

router.get(
  "/:id/export-erp",
  validate(idParamSchema, "params"),
  asyncHandler(ordersControllerV2.exportErp),
);

// ── POSTs (literals BEFORE /:id) ───────────────────────────────────────
router.post(
  "/",
  validate(createOrderBodySchema, "body"),
  asyncHandler(ordersControllerV2.create),
);

router.post(
  "/create-with-delivery",
  validate(createWithDeliveryBodySchema, "body"),
  asyncHandler(ordersControllerV2.createWithDelivery),
);

router.post(
  "/:id/request-reopen",
  validate(idParamSchema, "params"),
  validate(requestReopenBodySchema, "body"),
  asyncHandler(ordersControllerV2.requestReopen),
);

router.post(
  "/:id/approve-reopen",
  validate(idParamSchema, "params"),
  asyncHandler(ordersControllerV2.approveReopen),
);

router.post(
  "/:id/deny-reopen",
  validate(idParamSchema, "params"),
  asyncHandler(ordersControllerV2.denyReopen),
);

router.post(
  "/:id/finalize-edit",
  validate(idParamSchema, "params"),
  validate(finalizeEditBodySchema, "body"),
  asyncHandler(ordersControllerV2.finalizeEdit),
);

router.post(
  "/:id/substitute-item",
  validate(idParamSchema, "params"),
  validate(substituteItemBodySchema, "body"),
  asyncHandler(ordersControllerV2.substituteItem),
);

router.post(
  "/:id/danfe-log",
  validate(idParamSchema, "params"),
  validate(createDanfeLogBodySchema, "body"),
  asyncHandler(ordersControllerV2.createDanfeLog),
);

router.post(
  "/:id/generate-prenota",
  validate(idParamSchema, "params"),
  asyncHandler(ordersControllerV2.generatePrenota),
);

router.post(
  "/:id/bling-export",
  validate(idParamSchema, "params"),
  asyncHandler(ordersControllerV2.blingExport),
);

router.post(
  "/:id/transition",
  validate(idParamSchema, "params"),
  validate(transitionBodySchema, "body"),
  asyncHandler(ordersControllerV2.transition),
);

// ── PATCH ──────────────────────────────────────────────────────────────
router.patch(
  "/:id",
  ordersControllerV2.ensureNumericId,
  validate(idParamSchema, "params"),
  validate(updateOrderBodySchema, "body"),
  asyncHandler(ordersControllerV2.update),
);

router.patch(
  "/:id/fiscal",
  validate(idParamSchema, "params"),
  validate(updateFiscalBodySchema, "body"),
  asyncHandler(ordersControllerV2.updateFiscal),
);

// ── PUT ────────────────────────────────────────────────────────────────
router.put(
  "/:id/items",
  validate(idParamSchema, "params"),
  validate(updateOrderItemsBodySchema, "body"),
  asyncHandler(ordersControllerV2.replaceItems),
);

// ── DELETEs (literal /bulk BEFORE /:id) ────────────────────────────────
router.delete(
  "/bulk",
  validate(bulkDeleteBodySchema, "body"),
  asyncHandler(ordersControllerV2.bulkDelete),
);

router.delete(
  "/:id",
  ordersControllerV2.ensureNumericId,
  validate(idParamSchema, "params"),
  validate(deleteOrderBodySchema, "body"),
  asyncHandler(ordersControllerV2.remove),
);

export const ordersRouterV2 = router;
