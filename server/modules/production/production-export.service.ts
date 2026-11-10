import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ValidationError } from "../../shared/errors/AppError";
import { productionRepository } from "./production.repository";
import type { ProductionExportBatch, ProductionExportItem } from "./production-xlsx-mapping";
import { renderInNaturaWorkbook } from "./production-xlsx-renderer";
import { renderProcessedWorkbook, type ProductionShift } from "./production-processed-xlsx-renderer";

export type ProductionWorkbookKind = "in-natura" | "processed";

const TEMPLATE_DIRECTORY = resolve(process.cwd(), "server/modules/production/templates");

export interface ProductionWorkbookDownload {
  bytes: Buffer;
  filename: string;
  contentType: string;
  batchId: number;
}

export interface ProductionWorkbookExportOptions {
  shift?: ProductionShift;
  responsibleName?: string;
}

function asBatch(value: Awaited<ReturnType<typeof productionRepository.getGlobalBatchById>>): ProductionExportBatch {
  return {
    id: value.id,
    productionDate: String(value.productionDate).slice(0, 10),
    items: value.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      unit: item.unit,
      productionClassification: item.productionClassification as ProductionExportItem["productionClassification"],
      totalQuantity: item.totalQuantity,
      orderBreakdown: item.orderBreakdown,
    })),
  };
}

export const productionExportService = {
  async exportBatch(batchId: number, kind: ProductionWorkbookKind, options: ProductionWorkbookExportOptions = {}): Promise<ProductionWorkbookDownload> {
    // Read only the immutable batch. Do not reconstruct exports from current orders/catalog.
    const batch = asBatch(await productionRepository.getGlobalBatchById(batchId));
    const filenameDate = batch.productionDate.replace(/-/g, "");
    if (kind === "processed") {
      if (!batch.items.some((item) => item.productionClassification === "PROCESSADOS")) {
        throw new ValidationError("O lote não possui itens classificados como Processados.");
      }
      if (!options.shift) throw new ValidationError("Selecione o turno responsável pela produção antes de exportar Processados.");
      const responsibleName = options.responsibleName?.trim();
      if (!responsibleName) throw new ValidationError("Não foi possível identificar o usuário responsável pela exportação.");
      const template = await readFile(resolve(TEMPLATE_DIRECTORY, "processed-template.xlsx"));
      const shiftLabel = options.shift === "morning" ? "manha" : "tarde";
      return {
        bytes: renderProcessedWorkbook(template, batch, { shift: options.shift, responsibleName }),
        filename: `producao-processados-${filenameDate}-turno-${shiftLabel}-lote-${batch.id}.xlsx`,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        batchId: batch.id,
      };
    }

    if (!batch.items.some((item) => item.productionClassification === "IN_NATURA")) {
      throw new ValidationError("O lote não possui itens classificados como In Natura.");
    }
    const template = await readFile(resolve(TEMPLATE_DIRECTORY, "in-natura-template.xlsx"));
    return {
      bytes: renderInNaturaWorkbook(template, batch),
      filename: `producao-in-natura-${filenameDate}-lote-${batch.id}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      batchId: batch.id,
    };
  },
};
