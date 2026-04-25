import { Router } from "express";
import { asyncHandler } from "../../core/http/asyncHandler";
import { validateRequest } from "../../core/validation/validateRequest";
import { tenantContext } from "../../middleware/tenant";
import { ordersController } from "./orders.controller";
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
 * Orders router — wires HTTP method+path → middleware chain → controller.
 *
 * MIGRATION STATUS (mutations pass — see README.md for the full table):
 *   ✅ All read paths
 *   ✅ POST /api/orders                                (create)
 *   ✅ POST /api/orders/create-with-delivery          (admin/internal)
 *   ✅ PATCH /api/orders/:id                          (status/notes/nimbi)
 *   ✅ DELETE /api/orders/:id, /bulk                  (with fiscal-confirm)
 *   ✅ Reopen workflow (request/approve/deny/finalize)
 *   ✅ PUT /api/orders/:id/items                      (replace items)
 *   ✅ POST /api/orders/:id/substitute-item           (safra substitution)
 *   ✅ Fiscal/DANFE/ERP (logs, fiscal patch, prenota, bling, export-erp)
 *
 * REGISTRATION ORDER NOTE: Express matches routes in registration order.
 * Literal sibling paths (`/export`, `/reopen-requests`, `/bulk`,
 * `/create-with-delivery`) MUST be declared BEFORE the `/:id` wildcard so
 * they win the match. The `ensureNumericId` guard remains as a second line
 * of defense — see its doc-block in the controller.
 *
 * Anything not declared here falls through `next()` to the legacy
 * `server/routes/routes.ts`, so backward compatibility is total. Modules
 * are mounted BEFORE the legacy router (see `server/modules/index.ts`), so
 * the migrated handlers win the route match while everything else continues
 * to work.
 *
 * AUTH NOTE: this router mounts `tenantContext` globally — every endpoint
 * (read AND write) now resolves the authenticated principal into a tenant
 * id and pins it via AsyncLocalStorage. This is the security hardening that
 * supersedes the legacy "GET endpoints are public" contract: the previous
 * shape allowed `GET /api/orders?empresaId=N` from anyone, leaking other
 * tenants' orders. With `tenantContext` in place:
 *   - anonymous requests fail with 401 in the repository (see ordersRepository)
 *   - company users are pinned to their own company, no `?empresaId` override
 *   - cross-tenant admins (MASTER) may read all tenants implicitly, or
 *     target one with `?empresaId=N`.
 * Per-endpoint role enforcement still lives in the service layer.
 */
const router = Router();
router.use(tenantContext);

// ── GETs (literals BEFORE /:id) ────────────────────────────────────────
router.get(
  "/",
  validateRequest(listOrdersQuerySchema, "query"),
  asyncHandler(ordersController.list),
);

router.get(
  "/export",
  validateRequest(exportQuerySchema, "query"),
  asyncHandler(ordersController.export),
);

router.get(
  "/reopen-requests",
  asyncHandler(ordersController.reopenRequests),
);

router.get(
  "/:id",
  ordersController.ensureNumericId,
  validateRequest(idParamSchema, "params"),
  asyncHandler(ordersController.get),
);

router.get(
  "/:id/danfe-logs",
  validateRequest(idParamSchema, "params"),
  asyncHandler(ordersController.listDanfeLogs),
);

router.get(
  "/:id/export-erp",
  validateRequest(idParamSchema, "params"),
  asyncHandler(ordersController.exportErp),
);

// ── POSTs (literals BEFORE /:id) ───────────────────────────────────────
router.post(
  "/",
  validateRequest(createOrderBodySchema, "body"),
  asyncHandler(ordersController.create),
);

router.post(
  "/create-with-delivery",
  validateRequest(createWithDeliveryBodySchema, "body"),
  asyncHandler(ordersController.createWithDelivery),
);

router.post(
  "/:id/request-reopen",
  validateRequest(idParamSchema, "params"),
  validateRequest(requestReopenBodySchema, "body"),
  asyncHandler(ordersController.requestReopen),
);

router.post(
  "/:id/approve-reopen",
  validateRequest(idParamSchema, "params"),
  asyncHandler(ordersController.approveReopen),
);

router.post(
  "/:id/deny-reopen",
  validateRequest(idParamSchema, "params"),
  asyncHandler(ordersController.denyReopen),
);

router.post(
  "/:id/finalize-edit",
  validateRequest(idParamSchema, "params"),
  validateRequest(finalizeEditBodySchema, "body"),
  asyncHandler(ordersController.finalizeEdit),
);

router.post(
  "/:id/substitute-item",
  validateRequest(idParamSchema, "params"),
  validateRequest(substituteItemBodySchema, "body"),
  asyncHandler(ordersController.substituteItem),
);

router.post(
  "/:id/danfe-log",
  validateRequest(idParamSchema, "params"),
  validateRequest(createDanfeLogBodySchema, "body"),
  asyncHandler(ordersController.createDanfeLog),
);

router.post(
  "/:id/generate-prenota",
  validateRequest(idParamSchema, "params"),
  asyncHandler(ordersController.generatePrenota),
);

router.post(
  "/:id/bling-export",
  validateRequest(idParamSchema, "params"),
  asyncHandler(ordersController.blingExport),
);

/**
 * POST /api/orders/:id/transition
 *
 * Controlled state machine for the order workflow.
 * Body: { to: OrderStatus, reason?: string }
 *
 * This endpoint is purely ADDITIVE — it only updates `workflowStatus`.
 * The legacy `status` field and all existing endpoints remain unchanged.
 */
router.post(
  "/:id/transition",
  validateRequest(idParamSchema, "params"),
  validateRequest(transitionBodySchema, "body"),
  asyncHandler(ordersController.transition),
);

// ── PATCH ──────────────────────────────────────────────────────────────
router.patch(
  "/:id",
  ordersController.ensureNumericId,
  validateRequest(idParamSchema, "params"),
  validateRequest(updateOrderBodySchema, "body"),
  asyncHandler(ordersController.update),
);

router.patch(
  "/:id/fiscal",
  validateRequest(idParamSchema, "params"),
  validateRequest(updateFiscalBodySchema, "body"),
  asyncHandler(ordersController.updateFiscal),
);

// ── PUT ────────────────────────────────────────────────────────────────
router.put(
  "/:id/items",
  validateRequest(idParamSchema, "params"),
  validateRequest(updateOrderItemsBodySchema, "body"),
  asyncHandler(ordersController.replaceItems),
);

// ── DELETEs (literal /bulk BEFORE /:id) ────────────────────────────────
router.delete(
  "/bulk",
  validateRequest(bulkDeleteBodySchema, "body"),
  asyncHandler(ordersController.bulkDelete),
);

router.delete(
  "/:id",
  ordersController.ensureNumericId,
  validateRequest(idParamSchema, "params"),
  validateRequest(deleteOrderBodySchema, "body"),
  asyncHandler(ordersController.remove),
);

export const ordersRouter = router;
