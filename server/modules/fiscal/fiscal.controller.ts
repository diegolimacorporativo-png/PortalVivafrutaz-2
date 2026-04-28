import type { Request, Response } from "express";
import {
  createDraftFromOrder,
  getDraft,
  listDraftsByOrder,
  updateDraft,
} from "../../services/nf.draft";
// FASE NF.7.9 — agregação read-only de ICMS importado vs normal.
import { getIcmsSummary } from "../../services/nfe/icms-summary.service";

/**
 * Fiscal module controller — thin HTTP layer over services/nf.draft.ts.
 *
 * Validation já roda no router via validateRequest; aqui o body/params/query
 * já chegam parseados e tipados.
 */
export const fiscalController = {
  // GET /api/fiscal/drafts/:orderId — lista os drafts de um pedido
  async listByOrder(req: Request, res: Response) {
    const { orderId } = req.params as unknown as { orderId: number };
    const drafts = await listDraftsByOrder(orderId);
    res.json(drafts);
  },

  // POST /api/fiscal/drafts — cria draft a partir de orderId
  async create(req: Request, res: Response) {
    const { orderId, billingType } = req.body as {
      orderId: number;
      billingType?: "STANDARD" | "CONTRACT";
    };
    const draft = await createDraftFromOrder({ orderId, billingType });
    res.status(201).json(draft);
  },

  // GET /api/fiscal/drafts/id/:id — leitura por id (utilitário)
  async getById(req: Request, res: Response) {
    const { id } = req.params as unknown as { id: number };
    const draft = await getDraft(id);
    res.json(draft);
  },

  // PUT /api/fiscal/drafts/:id — update parcial (items/totals/status/billingType)
  async update(req: Request, res: Response) {
    const { id } = req.params as unknown as { id: number };
    const draft = await updateDraft(id, req.body as any);
    res.json(draft);
  },

  // FASE NF.7.9 — GET /api/fiscal/icms-summary
  // Retorna a separação ICMS Importados (4%) vs ICMS Normal (7/12/18%).
  // Tenant scope obrigatório (withTenantScope no router já preenche
  // req.empresaId). Sem mutação. Sem alteração no XML/cálculo. É só
  // leitura agregada das NF-es já emitidas.
  async icmsSummary(req: Request, res: Response) {
    const empresaId = (req as any).empresaId as number | undefined;
    if (!empresaId) {
      return res.status(400).json({ error: "tenant_required" });
    }
    const summary = await getIcmsSummary(empresaId);
    res.json(summary);
  },
};
