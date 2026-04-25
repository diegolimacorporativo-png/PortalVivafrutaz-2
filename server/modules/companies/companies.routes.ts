import { Router } from "express";
import { asyncHandler } from "../../core/http/asyncHandler";
import { tenantContext } from "../../middleware/tenant";
import { validateRequest } from "../../core/validation/validateRequest";
import { companiesController } from "./companies.controller";
import {
  idParamSchema,
  scopeParamSchema,
  adjParamSchema,
  addressParamSchema,
  createCompanySchema,
  updateCompanySchema,
  updatePreferredOrderTypeSchema,
  deliverySuggestionsQuerySchema,
  createContractScopeBodySchema,
  updateContractScopeBodySchema,
  updateContractInfoSchema,
  createContractAdjustmentBodySchema,
  updateContractAdjustmentBodySchema,
  sendAdjustmentEmailBodySchema,
  createCompanyAddressBodySchema,
  updateCompanyAddressBodySchema,
  gpsToggleSchema,
} from "./companies.validation";

/**
 * Companies router — wires HTTP method+path → middleware chain → controller.
 *
 * REGISTRATION ORDER NOTE: Express matches routes in registration order.
 * Literal sibling paths (`/my/preferred-order-type`, `/delivery-suggestions`)
 * MUST be declared BEFORE the `/:id` wildcard so they win the match.
 *
 * AUTH NOTE: this router mounts `tenantContext` globally. Every endpoint
 * resolves the authenticated principal into a tenant id and pins it via
 * AsyncLocalStorage. Anonymous requests fail with 401. This is the security
 * hardening that supersedes the legacy "no auth" contract on the basic
 * companies CRUD — the previous shape allowed unauthenticated `GET
 * /api/companies` from anyone, leaking the entire customer list.
 *
 * The repository's `assertCompanyAccess(id)` enforces tenant boundaries:
 *   - anonymous → 401 in tenantContext
 *   - company-portal user → may only touch own company
 *   - admin pinned to tenant N → may only touch tenant N
 *   - cross-tenant admin (MASTER, no pinning) → may touch any tenant
 *
 * Anything not declared here falls through `next()` to the legacy
 * `server/routes/routes.ts`. Modules are mounted BEFORE the legacy router
 * (see `server/modules/index.ts`), so the migrated handlers win.
 */
const router = Router();
router.use(tenantContext);

// ── Literals BEFORE /:id ───────────────────────────────────────────────
router.get(
  "/delivery-suggestions",
  validateRequest(deliverySuggestionsQuerySchema, "query"),
  asyncHandler(companiesController.deliverySuggestions),
);

router.patch(
  "/my/preferred-order-type",
  validateRequest(updatePreferredOrderTypeSchema, "body"),
  asyncHandler(companiesController.updatePreferredOrderType),
);

// ── CRUD ────────────────────────────────────────────────────────────────
router.get("/", asyncHandler(companiesController.list));

router.post(
  "/",
  validateRequest(createCompanySchema, "body"),
  asyncHandler(companiesController.create),
);

router.get(
  "/:id",
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.get),
);

router.put(
  "/:id",
  validateRequest(idParamSchema, "params"),
  validateRequest(updateCompanySchema, "body"),
  asyncHandler(companiesController.update),
);

router.delete(
  "/:id",
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.remove),
);

// ── Contract scopes ─────────────────────────────────────────────────────
router.get(
  "/:id/contract-scopes",
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.listScopes),
);

router.post(
  "/:id/contract-scopes",
  validateRequest(idParamSchema, "params"),
  validateRequest(createContractScopeBodySchema, "body"),
  asyncHandler(companiesController.createScope),
);

router.put(
  "/:id/contract-scopes/:scopeId",
  validateRequest(scopeParamSchema, "params"),
  validateRequest(updateContractScopeBodySchema, "body"),
  asyncHandler(companiesController.updateScope),
);

router.delete(
  "/:id/contract-scopes/:scopeId",
  validateRequest(scopeParamSchema, "params"),
  asyncHandler(companiesController.deleteScope),
);

// ── Contract management ────────────────────────────────────────────────
router.patch(
  "/:id/contract-info",
  validateRequest(idParamSchema, "params"),
  validateRequest(updateContractInfoSchema, "body"),
  asyncHandler(companiesController.updateContractInfo),
);

router.get(
  "/:id/contract-adjustments",
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.listAdjustments),
);

router.post(
  "/:id/contract-adjustments",
  validateRequest(idParamSchema, "params"),
  validateRequest(createContractAdjustmentBodySchema, "body"),
  asyncHandler(companiesController.createAdjustment),
);

router.patch(
  "/:id/contract-adjustments/:adjId",
  validateRequest(adjParamSchema, "params"),
  validateRequest(updateContractAdjustmentBodySchema, "body"),
  asyncHandler(companiesController.updateAdjustment),
);

router.post(
  "/:id/contract-adjustments/:adjId/send-email",
  validateRequest(adjParamSchema, "params"),
  validateRequest(sendAdjustmentEmailBodySchema, "body"),
  asyncHandler(companiesController.sendAdjustmentEmail),
);

// ── generate-orders-from-scope ─────────────────────────────────────────
router.post(
  "/:id/generate-orders-from-scope",
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.generateOrdersFromScope),
);

// ── Company addresses ──────────────────────────────────────────────────
router.get(
  "/:id/addresses",
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.listAddresses),
);

router.post(
  "/:id/addresses",
  validateRequest(idParamSchema, "params"),
  validateRequest(createCompanyAddressBodySchema, "body"),
  asyncHandler(companiesController.createAddress),
);

router.put(
  "/:companyId/addresses/:addrId",
  validateRequest(addressParamSchema, "params"),
  validateRequest(updateCompanyAddressBodySchema, "body"),
  asyncHandler(companiesController.updateAddress),
);

router.delete(
  "/:companyId/addresses/:addrId",
  validateRequest(addressParamSchema, "params"),
  asyncHandler(companiesController.deleteAddress),
);

router.patch(
  "/:companyId/addresses/:addrId/set-primary",
  validateRequest(addressParamSchema, "params"),
  asyncHandler(companiesController.setPrimaryAddress),
);

// ── GPS ────────────────────────────────────────────────────────────────
router.get(
  "/:id/gps-status",
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.gpsStatus),
);

router.post(
  "/:id/gps-toggle",
  validateRequest(idParamSchema, "params"),
  validateRequest(gpsToggleSchema, "body"),
  asyncHandler(companiesController.gpsToggle),
);

export const companiesRouter = router;
