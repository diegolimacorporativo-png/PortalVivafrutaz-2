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

// ── NF-e Monitoring (FASE NF.7.5/7.6) ────────────────────────────────────
// Read-only: count of issued NF-e grouped by emitter UF (extracted from XML).
// Useful for prioritizing the next batch of SEFAZ webservice URLs to map.
router.get(
  "/nfe/resumo-por-uf",
  asyncHandler(financeController.getNfeResumoPorUF),
);
// Read-only: count of issued NF-e grouped by fiscal status (gerada,
// autorizada, rejeitada, etc.) for pipeline diagnostics.
router.get(
  "/nfe/resumo-por-status",
  asyncHandler(financeController.getNfeResumoPorStatus),
);
// FASE FISCAL 7.9 — read-only: motivos de rejeição (cStat/xMotivo) com
// `orderId` e sugestão de correção, para o card de "Ação Rápida" abrir o
// pedido relacionado direto da tela de finanças.
router.get(
  "/nfe/motivos-rejeicao",
  asyncHandler(financeController.getNfeMotivosRejeicao),
);

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
// FASE 6.5 — breakdown de pagamento (principal + juros + multa + desconto).
// Read-only, mesma cadeia de auth + tenant scope; idParamSchema reusa a
// validação numérica das outras rotas de :id.
router.get(
  "/accounts-receivable/:id/breakdown",
  validateRequest(idParamSchema, "params"),
  asyncHandler(financeController.getReceivableBreakdown),
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
