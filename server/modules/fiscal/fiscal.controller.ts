import type { Request, Response } from "express";
import {
  createDraftFromOrder,
  getDraft,
  listDraftsByOrder,
  updateDraft,
} from "../../services/nf.draft";
// FASE NF.7.9 — agregação read-only de ICMS importado vs normal.
import { getIcmsSummary } from "../../services/nfe/icms-summary.service";
// FASE NF.7.9.2 — fechamento mensal fiscal (TRAVAR PERÍODO).
import { closePeriod } from "../../services/fiscal/fiscal-closure.service";
// FASE NF.7.9.8 — listagem read-only de meses fiscais já fechados.
import { listClosedPeriods } from "../../services/fiscal/fiscal-closure.query";

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
  //
  // FASE NF.7.9.1 — agora aceita filtros opcionais ?startDate=YYYY-MM-DD
  // e ?endDate=YYYY-MM-DD. Validação estrita fica para fase futura
  // (spec ETAPA 3) — strings inválidas são silenciosamente ignoradas
  // pelo service (parseStartOfDay/parseEndOfDay retornam null).
  async icmsSummary(req: Request, res: Response) {
    const empresaId = (req as any).empresaId as number | undefined;
    if (!empresaId) {
      return res.status(400).json({ error: "tenant_required" });
    }
    const { startDate, endDate } = req.query as {
      startDate?: string;
      endDate?: string;
    };
    const summary = await getIcmsSummary(
      empresaId,
      typeof startDate === "string" ? startDate : undefined,
      typeof endDate === "string" ? endDate : undefined,
    );
    res.json(summary);
  },

  // FASE NF.7.9.3 — GET /api/fiscal/icms-summary/export
  // Exporta o mesmo resumo do endpoint icmsSummary em CSV (uso contábil).
  // Reutiliza o service getIcmsSummary — NÃO duplica lógica nem altera o
  // payload do endpoint JSON existente. Aceita os mesmos filtros opcionais
  // (?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD). Sem dados → CSV com zeros.
  async icmsSummaryExport(req: Request, res: Response) {
    const empresaId = (req as any).empresaId as number | undefined;
    if (!empresaId) {
      return res.status(400).json({ error: "tenant_required" });
    }
    const { startDate, endDate } = req.query as {
      startDate?: string;
      endDate?: string;
    };
    const summary = await getIcmsSummary(
      empresaId,
      typeof startDate === "string" ? startDate : undefined,
      typeof endDate === "string" ? endDate : undefined,
    );

    // Formata número como "0.00" (ponto decimal — padrão CSV/contábil
    // internacional, importável direto no Excel/LibreOffice/SPED).
    const n = (v: number) => (Number.isFinite(v) ? v : 0).toFixed(2);

    const lines: string[] = [
      "Tipo,NF-es,Itens,Base ICMS,Valor ICMS",
      `Importado,${summary.importado.totalNFs},${summary.importado.totalItens},${n(summary.importado.totalBase)},${n(summary.importado.totalICMS)}`,
      `Normal,${summary.normal.totalNFs},${summary.normal.totalItens},${n(summary.normal.totalBase)},${n(summary.normal.totalICMS)}`,
    ];
    const csv = lines.join("\r\n") + "\r\n";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="icms-summary.csv"',
    );
    return res.send(csv);
  },

  // FASE NF.7.9.5 — GET /api/fiscal/icms-summary/export-xlsx
  // Exporta o mesmo resumo do endpoint icmsSummary em XLSX (Excel nativo).
  // Reutiliza o service getIcmsSummary — NÃO duplica lógica nem altera o
  // payload do endpoint JSON existente nem o CSV. Aceita os mesmos filtros
  // opcionais (?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD). Sem dados →
  // planilha com zeros. Usa `await import("xlsx")` (mesmo padrão dos
  // outros consumidores em server/routes/routes.ts:994 e :3487 — projeto
  // é ESM, `require` não funciona).
  async icmsSummaryExportXlsx(req: Request, res: Response) {
    const empresaId = (req as any).empresaId as number | undefined;
    if (!empresaId) {
      return res.status(400).json({ error: "tenant_required" });
    }
    const { startDate, endDate } = req.query as {
      startDate?: string;
      endDate?: string;
    };
    const summary = await getIcmsSummary(
      empresaId,
      typeof startDate === "string" ? startDate : undefined,
      typeof endDate === "string" ? endDate : undefined,
    );

    const XLSX = await import("xlsx");

    const data = [
      ["Tipo", "NF-es", "Itens", "Base ICMS", "Valor ICMS"],
      [
        "Importado",
        summary.importado.totalNFs,
        summary.importado.totalItens,
        summary.importado.totalBase,
        summary.importado.totalICMS,
      ],
      [
        "Normal",
        summary.normal.totalNFs,
        summary.normal.totalItens,
        summary.normal.totalBase,
        summary.normal.totalICMS,
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resumo ICMS");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="icms-summary.xlsx"',
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    return res.send(buffer);
  },

  // FASE NF.7.9.2 — POST /api/fiscal/close-period
  // Fecha um mês fiscal para o tenant atual. Roda DEPOIS de
  // requireAuth + withTenantScope (router monta na linha 27). Body:
  //   { year: number, month: number }
  // Resposta: { success: true, year, month }
  // NÃO valida duplicidade (spec — fase futura).
  async closePeriod(req: Request, res: Response) {
    const empresaId = (req as any).empresaId as number | undefined;
    if (!empresaId) {
      return res.status(400).json({ error: "tenant_required" });
    }
    const { year, month } = (req.body ?? {}) as { year?: number; month?: number };
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || y < 2000 || y > 9999) {
      return res.status(400).json({ error: "year inválido" });
    }
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      return res.status(400).json({ error: "month inválido (1-12)" });
    }
    await closePeriod(empresaId, y, m);
    return res.json({ success: true, year: y, month: m });
  },

  // FASE NF.7.9.8 — GET /api/fiscal/closures
  // Lista os meses fiscais já fechados para o tenant atual. Read-only,
  // multi-tenant isolado (empresaId vem do withTenantScope). Mesmo padrão
  // de envelope { success, data } do projeto. Sem cache, sem paginação,
  // sem reopen — apenas exposição da tabela `fiscal_closures`.
  async listClosures(req: Request, res: Response) {
    const empresaId = (req as any).empresaId as number | undefined;
    if (!empresaId) {
      return res.status(400).json({ error: "tenant_required" });
    }
    const data = await listClosedPeriods(empresaId);
    return res.json({ success: true, data });
  },
};
