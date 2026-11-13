import { BadRequestError, ConflictError } from "../../shared/errors/AppError";
import { assertProductionGlobalAccess } from "./production-authorization";
import { productionRepository } from "./production.repository";
import type { BatchWithItems } from "./production.repository";
import { consolidateProduction } from "./production-consolidation";
import { assessProductionPreview, fingerprintProductionConsolidation } from "./production-preview";
import type { GenerateBatchBody, ManualBatchItemBody, ManualExportMappingBody } from "./production.validation";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDENTE: ["EM_PRODUCAO"],
  EM_PRODUCAO: ["CONFERIDO", "PENDENTE"],
  CONFERIDO: ["FINALIZADO", "EM_PRODUCAO"],
  FINALIZADO: [],
};

function isGlobalDateConflict(error: any): boolean {
  return (error?.code === "23505" || error?.cause?.code === "23505") &&
    (error?.constraint === "production_batches_global_date_unique" || error?.cause?.constraint === "production_batches_global_date_unique");
}

function isSerializationConflict(error: any): boolean {
  return error?.code === "40001" || error?.cause?.code === "40001";
}

async function loadConsolidation(date: string, tx: any) {
  const [rows, routes, missingContractOccurrences] = await Promise.all([
    productionRepository.getGlobalSourceRowsForDate(date, tx),
    productionRepository.getGlobalRoutesForDate(date, tx),
    productionRepository.getMissingContractOccurrencesForDate(date, tx),
  ]);
  return consolidateProduction(date, rows, routes, missingContractOccurrences);
}

function buildPreview(consolidation: Awaited<ReturnType<typeof loadConsolidation>>) {
  return {
    ...consolidation,
    ...assessProductionPreview(consolidation),
    previewFingerprint: fingerprintProductionConsolidation(consolidation),
  };
}

export const productionService = {
  async getConsolidationForDate(productionDate: string) {
    assertProductionGlobalAccess();
    return productionRepository.withGlobalTransaction(async (tx) => {
      return buildPreview(await loadConsolidation(productionDate, tx));
    });
  },

  /** Creates exactly one global daily batch from an isolated, repeatable-read snapshot. */
  async generateBatch(body: GenerateBatchBody): Promise<BatchWithItems & {
    pending: any;
    previewFingerprint: string;
    indicators: ReturnType<typeof assessProductionPreview>["indicators"];
  }> {
    assertProductionGlobalAccess();
    try {
      return await productionRepository.withGlobalTransaction(async (tx) => {
        const existing = await productionRepository.findGlobalBatchByDate(body.productionDate, tx);
        if (existing) {
          throw new ConflictError(`Já existe produção global para ${body.productionDate}.`);
        }

        const consolidation = await loadConsolidation(body.productionDate, tx);
        const preview = buildPreview(consolidation);
        if (preview.previewFingerprint !== body.previewFingerprint) {
          throw new ConflictError("Os pedidos, contratos ou ocorrências mudaram desde a prévia. Atualize a conferência antes de gerar o lote.");
        }
        if (!preview.canGenerate) {
          throw new BadRequestError(`A produção não pode ser gerada: ${preview.blockers.join(" ")}`);
        }

        const items = consolidation.products.map((product) => ({
          productId: product.productId,
          productName: product.productName,
          category: product.category,
          productionClassification: product.productionClassification,
          unit: product.unit,
          totalQuantity: product.totalQuantity,
          orderBreakdown: product.sources,
          routeBreakdown: product.routeBreakdown,
        }));
        const batch = await productionRepository.createGlobalBatchInTransaction(tx, body.productionDate, items);
        return { ...batch, pending: consolidation.pending, previewFingerprint: preview.previewFingerprint, indicators: preview.indicators };
      }, "serializable");
    } catch (error) {
      if (isGlobalDateConflict(error)) {
        throw new ConflictError(`Outra execução já criou a produção global para ${body.productionDate}.`);
      }
      if (isSerializationConflict(error)) {
        throw new ConflictError("Os dados da produção mudaram durante a confirmação. Atualize a prévia e confirme novamente.");
      }
      throw error;
    }
  },

  async list(_empresaId: number | null, opts: { status?: string; date?: string; page: number; limit: number }) {
    assertProductionGlobalAccess();
    return productionRepository.listGlobal(opts);
  },

  async getById(id: number, _empresaId: number | null) {
    assertProductionGlobalAccess();
    return productionRepository.getGlobalBatchById(id);
  },

  async updateStatus(id: number, _empresaId: number | null, newStatus: string, notes?: string) {
    assertProductionGlobalAccess();
    const batch = await productionRepository.getGlobalBatchById(id);
    const allowed = ALLOWED_TRANSITIONS[batch.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestError(`Transição inválida: ${batch.status} → ${newStatus}. Permitidas: ${allowed.join(", ") || "nenhuma"}`);
    }
    return productionRepository.updateGlobalStatus(id, newStatus, notes);
  },

  async updateItemCheck(itemId: number, _empresaId: number | null, checkedQuantity: number, notes?: string) {
    assertProductionGlobalAccess();
    return productionRepository.updateGlobalItemCheck(itemId, checkedQuantity, notes);
  },

  async addManualBatchItem(batchId: number, body: ManualBatchItemBody, recordedByUserId: number) {
    assertProductionGlobalAccess();
    return productionRepository.addManualGlobalBatchItem({ ...body, batchId, recordedByUserId });
  },

  async updateManualExportMapping(batchId: number, body: ManualExportMappingBody, userId: number) {
    assertProductionGlobalAccess();
    return productionRepository.updateManualExportMapping({ ...body, batchId, userId });
  },

  async deleteBatch(id: number, _empresaId: number | null) {
    assertProductionGlobalAccess();
    await productionRepository.getGlobalBatchById(id);
    await productionRepository.deleteGlobalBatch(id);
  },
};
