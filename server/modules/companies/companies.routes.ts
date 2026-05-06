import { Router } from "express";
import { asyncHandler } from "../../core/http/asyncHandler";
import { tenantContext } from "../../middleware/tenant";
import { requireAuthOrService } from "../../middleware/serviceAuth";
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
 * AUTH MODEL
 * ----------
 * Every endpoint runs `tenantContext` to pin the tenant via
 * AsyncLocalStorage. Anonymous requests fail with 401. This is the security
 * hardening that supersedes the legacy "no auth" contract on basic
 * companies CRUD — the previous shape allowed unauthenticated `GET
 * /api/companies`, leaking the entire customer list.
 *
 * Two auth modes are accepted, gated per-route:
 *   - **Session-only** (default): the request must carry `req.session.userId`
 *     or `req.session.companyId`. Used for ALL mutating endpoints — service
 *     callers cannot create/update/delete companies, scopes, addresses, etc.
 *   - **Session-or-service**: read endpoints listed below also accept
 *     `x-api-key: <INTERNAL_API_KEY>` for unattended consumers (cron jobs,
 *     GPS daemon, ERP integration, NF-e poller). Service callers MUST still
 *     pass `?empresaId=N` or `X-Empresa-Id`; tenant isolation is enforced.
 *
 * The repository's `assertCompanyAccess(id)` enforces tenant boundaries:
 *   - anonymous → 401 in `requireAuthOrService` / `tenantContext`
 *   - company-portal user → may only touch own company
 *   - admin pinned to tenant N → may only touch tenant N
 *   - cross-tenant admin (MASTER, no pinning) → may touch any tenant
 *   - service caller → constrained to the tenant supplied via header/query
 *
 * Anything not declared here falls through `next()` to the legacy
 * `server/routes/routes.ts`. Modules are mounted BEFORE the legacy router
 * (see `server/modules/index.ts`), so the migrated handlers win.
 */
const router = Router();

// Convenience: every endpoint that opted into service-or-session auth gets
// the same prefix chain. Putting `requireAuthOrService` BEFORE
// `tenantContext` is required — the latter inspects `req.isService` to
// decide whether it must derive the tenant from the session or from the
// `X-Empresa-Id`/`?empresaId=` channel.
const readGate = [requireAuthOrService, tenantContext] as const;

// Mutating endpoints require explicit authentication. requireAuthOrService
// ensures only authenticated sessions (or service tokens) reach tenantContext,
// which then enforces session-only access for writes. This makes the protection
// explicit and auditable rather than relying on tenantContext's implicit behavior.
const writeGate = [requireAuthOrService, tenantContext] as const;

// ── Literals BEFORE /:id ───────────────────────────────────────────────
// Read — usable by service callers (e.g. logistics map needs to enumerate
// delivery windows on a daily cron).
router.get(
  "/delivery-suggestions",
  ...readGate,
  validateRequest(deliverySuggestionsQuerySchema, "query"),
  asyncHandler(companiesController.deliverySuggestions),
);

// Write — must come from the company portal. Service callers cannot mutate
// a tenant's preferences on their behalf.
router.patch(
  "/my/preferred-order-type",
  ...writeGate,
  validateRequest(updatePreferredOrderTypeSchema, "body"),
  asyncHandler(companiesController.updatePreferredOrderType),
);

// ── CRUD ────────────────────────────────────────────────────────────────
// LIST is the canonical replacement for the previously-public endpoint.
// Service callers receive ONLY the tenant they pinned via header/query.
router.get("/", ...readGate, asyncHandler(companiesController.list));

router.post(
  "/",
  ...writeGate,
  validateRequest(createCompanySchema, "body"),
  asyncHandler(companiesController.create),
);

router.get(
  "/:id",
  ...readGate,
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.get),
);

router.put(
  "/:id",
  ...writeGate,
  validateRequest(idParamSchema, "params"),
  validateRequest(updateCompanySchema, "body"),
  asyncHandler(companiesController.update),
);

router.delete(
  "/:id",
  ...writeGate,
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.remove),
);

// ── Contract scopes ─────────────────────────────────────────────────────
router.get(
  "/:id/contract-scopes",
  ...readGate,
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.listScopes),
);

router.post(
  "/:id/contract-scopes",
  ...writeGate,
  validateRequest(idParamSchema, "params"),
  validateRequest(createContractScopeBodySchema, "body"),
  asyncHandler(companiesController.createScope),
);

router.put(
  "/:id/contract-scopes/:scopeId",
  ...writeGate,
  validateRequest(scopeParamSchema, "params"),
  validateRequest(updateContractScopeBodySchema, "body"),
  asyncHandler(companiesController.updateScope),
);

router.delete(
  "/:id/contract-scopes/:scopeId",
  ...writeGate,
  validateRequest(scopeParamSchema, "params"),
  asyncHandler(companiesController.deleteScope),
);

// ── Contract management ────────────────────────────────────────────────
router.patch(
  "/:id/contract-info",
  ...writeGate,
  validateRequest(idParamSchema, "params"),
  validateRequest(updateContractInfoSchema, "body"),
  asyncHandler(companiesController.updateContractInfo),
);

router.get(
  "/:id/contract-adjustments",
  ...readGate,
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.listAdjustments),
);

router.post(
  "/:id/contract-adjustments",
  ...writeGate,
  validateRequest(idParamSchema, "params"),
  validateRequest(createContractAdjustmentBodySchema, "body"),
  asyncHandler(companiesController.createAdjustment),
);

router.patch(
  "/:id/contract-adjustments/:adjId",
  ...writeGate,
  validateRequest(adjParamSchema, "params"),
  validateRequest(updateContractAdjustmentBodySchema, "body"),
  asyncHandler(companiesController.updateAdjustment),
);

router.post(
  "/:id/contract-adjustments/:adjId/send-email",
  ...writeGate,
  validateRequest(adjParamSchema, "params"),
  validateRequest(sendAdjustmentEmailBodySchema, "body"),
  asyncHandler(companiesController.sendAdjustmentEmail),
);

// ── generate-orders-from-scope ─────────────────────────────────────────
// This is a write (it creates orders), so even though the legacy GPS cron
// could have triggered it, we force a human session. If we ever need the
// nightly scheduler to call it, wire a dedicated job runner that mints a
// trusted internal session — do NOT loosen this to a header check.
router.post(
  "/:id/generate-orders-from-scope",
  ...writeGate,
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.generateOrdersFromScope),
);

// ── Company addresses ──────────────────────────────────────────────────
router.get(
  "/:id/addresses",
  ...readGate,
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.listAddresses),
);

router.post(
  "/:id/addresses",
  ...writeGate,
  validateRequest(idParamSchema, "params"),
  validateRequest(createCompanyAddressBodySchema, "body"),
  asyncHandler(companiesController.createAddress),
);

router.put(
  "/:companyId/addresses/:addrId",
  ...writeGate,
  validateRequest(addressParamSchema, "params"),
  validateRequest(updateCompanyAddressBodySchema, "body"),
  asyncHandler(companiesController.updateAddress),
);

router.delete(
  "/:companyId/addresses/:addrId",
  ...writeGate,
  validateRequest(addressParamSchema, "params"),
  asyncHandler(companiesController.deleteAddress),
);

router.patch(
  "/:companyId/addresses/:addrId/set-primary",
  ...writeGate,
  validateRequest(addressParamSchema, "params"),
  asyncHandler(companiesController.setPrimaryAddress),
);

// ── GPS ────────────────────────────────────────────────────────────────
// Read — the GPS daemon polls this every minute and benefits from
// service-mode access (no human session needed).
router.get(
  "/:id/gps-status",
  ...readGate,
  validateRequest(idParamSchema, "params"),
  asyncHandler(companiesController.gpsStatus),
);

// Write — toggling GPS is gated by role (MASTER/ADMIN/DIRECTOR) inside the
// service layer. A service token cannot satisfy the role check, so this
// stays session-only.
router.post(
  "/:id/gps-toggle",
  ...writeGate,
  validateRequest(idParamSchema, "params"),
  validateRequest(gpsToggleSchema, "body"),
  asyncHandler(companiesController.gpsToggle),
);

export const companiesRouter = router;
