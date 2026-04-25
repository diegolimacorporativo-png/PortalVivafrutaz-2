import { Router } from "express";
import { asyncHandler } from "../../core/http/asyncHandler";
import { requireAuth } from "../../core/http/requireAuth";
import { withTenantScope } from "../../middleware/tenant";
import { validateRequest } from "../../core/validation/validateRequest";
import { financeController } from "./finance.controller";
import {
  createAccountReceivableSchema,
  updateAccountReceivableSchema,
  accountsReceivableQuerySchema,
  createAccountPayableSchema,
  updateAccountPayableSchema,
  accountsPayableQuerySchema,
  cashflowQuerySchema,
  createCashflowEntrySchema,
  idParamSchema,
} from "./finance.validation";

/**
 * Finance router — wires HTTP method+path → middleware chain → controller.
 *
 * Architecture decision: the router file is the only place where validation,
 * auth, and the controller meet. Reading this file alone tells you the full
 * contract of the module.
 *
 * All routes require auth, so requireAuth is mounted once on the router.
 */
const router = Router();
// Auth gate first (401 if no session), then tenant scope: resolves the
// authenticated principal into an empresaId, refuses if absent, and pins it
// to the request via AsyncLocalStorage. Every controller below this line can
// safely call `requireTenantId()` from any depth.
router.use(requireAuth, withTenantScope);

// ── Dashboard ────────────────────────────────────────────────────────────
router.get("/dashboard", asyncHandler(financeController.getDashboard));

// ── Accounts Receivable ──────────────────────────────────────────────────
router.get(
  "/accounts-receivable",
  validateRequest(accountsReceivableQuerySchema, "query"),
  asyncHandler(financeController.listAccountsReceivable),
);
router.post(
  "/accounts-receivable",
  validateRequest(createAccountReceivableSchema),
  asyncHandler(financeController.createAccountReceivable),
);
router.patch(
  "/accounts-receivable/:id",
  validateRequest(idParamSchema, "params"),
  validateRequest(updateAccountReceivableSchema),
  asyncHandler(financeController.updateAccountReceivable),
);
router.patch(
  "/accounts-receivable/:id/pay",
  validateRequest(idParamSchema, "params"),
  asyncHandler(financeController.payAccountReceivable),
);
router.delete(
  "/accounts-receivable/:id",
  validateRequest(idParamSchema, "params"),
  asyncHandler(financeController.deleteAccountReceivable),
);

// ── Accounts Payable ─────────────────────────────────────────────────────
router.get(
  "/accounts-payable",
  validateRequest(accountsPayableQuerySchema, "query"),
  asyncHandler(financeController.listAccountsPayable),
);
router.post(
  "/accounts-payable",
  validateRequest(createAccountPayableSchema),
  asyncHandler(financeController.createAccountPayable),
);
router.patch(
  "/accounts-payable/:id",
  validateRequest(idParamSchema, "params"),
  validateRequest(updateAccountPayableSchema),
  asyncHandler(financeController.updateAccountPayable),
);
router.patch(
  "/accounts-payable/:id/pay",
  validateRequest(idParamSchema, "params"),
  asyncHandler(financeController.payAccountPayable),
);
router.delete(
  "/accounts-payable/:id",
  validateRequest(idParamSchema, "params"),
  asyncHandler(financeController.deleteAccountPayable),
);

// ── Cashflow ─────────────────────────────────────────────────────────────
router.get(
  "/cashflow",
  validateRequest(cashflowQuerySchema, "query"),
  asyncHandler(financeController.listCashflow),
);
router.post(
  "/cashflow",
  validateRequest(createCashflowEntrySchema),
  asyncHandler(financeController.createCashflowEntry),
);

// ── PIX ──────────────────────────────────────────────────────────────────
router.get(
  "/pix/:id",
  validateRequest(idParamSchema, "params"),
  asyncHandler(financeController.getPixForReceivable),
);

export const financeRouter = router;
