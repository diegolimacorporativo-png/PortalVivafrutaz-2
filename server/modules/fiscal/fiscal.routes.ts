import { Router } from "express";
import { asyncHandler } from "../../core/http/asyncHandler";
import { requireAuth } from "../../core/http/requireAuth";
import { withTenantScope } from "../../middleware/tenant";
import { validateRequest } from "../../core/validation/validateRequest";
import { fiscalController } from "./fiscal.controller";
import {
  createDraftSchema,
  updateDraftSchema,
  idParamSchema,
  orderIdParamSchema,
} from "./fiscal.validation";

/**
 * Fiscal router — STEP FISCAL 1 (NF Draft Engine, isolado).
 *
 * Mounted at /api/fiscal (canonical) and /api/v1/fiscal (alias).
 *
 * Não substitui nem modifica nenhum endpoint existente:
 *   - /api/nfe              → emissões reais (intacto)
 *   - /api/nf-manual        → NF manual (intacto)
 *   - /api/fiscal-invoices  → OCR de NF de entrada (intacto)
 *
 * Toda rota exige autenticação + tenant scope (igual ao finance).
 */
const router = Router();
router.use(requireAuth, withTenantScope);

// GET /api/fiscal/drafts/:orderId  → lista drafts de um pedido
router.get(
  "/drafts/:orderId",
  validateRequest(orderIdParamSchema, "params"),
  asyncHandler(fiscalController.listByOrder),
);

// GET /api/fiscal/drafts/id/:id    → utilitário para leitura por id de draft
router.get(
  "/drafts/id/:id",
  validateRequest(idParamSchema, "params"),
  asyncHandler(fiscalController.getById),
);

// POST /api/fiscal/drafts          → cria draft a partir de orderId
router.post(
  "/drafts",
  validateRequest(createDraftSchema),
  asyncHandler(fiscalController.create),
);

// PUT /api/fiscal/drafts/:id       → edição total (items/totals/status)
router.put(
  "/drafts/:id",
  validateRequest(idParamSchema, "params"),
  validateRequest(updateDraftSchema),
  asyncHandler(fiscalController.update),
);

// FASE NF.7.9 — GET /api/fiscal/icms-summary
// Endpoint NOVO, 100% aditivo. Não toca os 4 endpoints de drafts acima.
// Mesmo middleware (requireAuth + withTenantScope) → tenant scope herdado.
router.get(
  "/icms-summary",
  asyncHandler(fiscalController.icmsSummary),
);

// FASE NF.7.9.3 — GET /api/fiscal/icms-summary/export
// Exporta o resumo ICMS em CSV (Importado vs Normal). Mesmos filtros
// do endpoint JSON. Aditivo — não altera o /icms-summary existente.
router.get(
  "/icms-summary/export",
  asyncHandler(fiscalController.icmsSummaryExport),
);

// FASE NF.7.9.5 — GET /api/fiscal/icms-summary/export-xlsx
// Exporta o resumo ICMS em XLSX (Excel nativo). Mesmos filtros do
// endpoint JSON e do CSV. Aditivo — não altera nenhum endpoint anterior.
router.get(
  "/icms-summary/export-xlsx",
  asyncHandler(fiscalController.icmsSummaryExportXlsx),
);

// FASE NF.7.9.2 — POST /api/fiscal/close-period
// Fecha um mês fiscal para o tenant atual. Aditivo, não toca o resto.
router.post(
  "/close-period",
  asyncHandler(fiscalController.closePeriod),
);

// FASE NF.7.9.8 — GET /api/fiscal/closures
// Lista os meses fiscais já fechados para o tenant logado. Read-only,
// herda requireAuth + withTenantScope. Aditivo — base para o badge
// persistente do frontend (próxima fase).
router.get(
  "/closures",
  asyncHandler(fiscalController.listClosures),
);

export const fiscalRouter = router;
