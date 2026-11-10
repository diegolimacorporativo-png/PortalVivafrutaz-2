import { createHash } from "node:crypto";
import type { ProductionConsolidation } from "./production-consolidation";

export interface ProductionPreviewIndicators {
  productCount: number;
  companyCount: number;
  orderCount: number;
  itemCount: number;
  pendingCount: number;
  inconsistencyCount: number;
}

export interface ProductionPreviewReadiness {
  canGenerate: boolean;
  blockers: string[];
  indicators: ProductionPreviewIndicators;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

export function fingerprintProductionConsolidation(consolidation: ProductionConsolidation): string {
  const canonical = JSON.stringify(canonicalize(consolidation));
  return createHash("sha256").update(canonical).digest("hex");
}

export function assessProductionPreview(consolidation: ProductionConsolidation): ProductionPreviewReadiness {
  const sources = consolidation.products.flatMap((product) => product.sources);
  const itemIds = sources.map((source) => source.itemId);
  const pending = consolidation.pending;
  const pendingCount = pending.missingContractOccurrences.length + pending.unidentifiedItems.length +
    pending.unclassifiedItems.length + pending.ineligibleOrders.length + pending.inconsistentOrigins.length;
  const blockers: string[] = [];

  if (consolidation.products.length === 0) blockers.push("Nenhum produto elegível para produção nesta data.");
  if (pending.missingContractOccurrences.length > 0) blockers.push("Há escopos contratuais válidos sem ocorrência materializada; a demanda diária pode estar incompleta.");
  if (pending.unidentifiedItems.length > 0) blockers.push("Há itens sem identificação confiável de produto.");
  if (pending.unclassifiedItems.length > 0) blockers.push("Há produtos sem classificação oficial para produção.");
  if (pending.inconsistentOrigins.length > 0) blockers.push("Há inconsistências de origem que comprometem a rastreabilidade.");

  for (const product of consolidation.products) {
    const sourceTotal = product.sources.reduce((sum, source) => sum + source.quantity, 0);
    if (Math.abs(sourceTotal - product.totalQuantity) > 0.0005) {
      blockers.push(`A composição de ${product.productName} não corresponde ao total consolidado.`);
    }
    if (product.sources.length === 0) blockers.push(`${product.productName} não possui itens de origem.`);
  }
  const duplicateItemCount = itemIds.length - new Set(itemIds).size;
  if (duplicateItemCount > 0) blockers.push("Um item de pedido aparece mais de uma vez na composição.");

  const indicators: ProductionPreviewIndicators = {
    productCount: consolidation.products.length,
    companyCount: new Set(sources.map((source) => source.companyId)).size,
    orderCount: new Set(sources.map((source) => source.orderId)).size,
    itemCount: new Set(itemIds).size,
    pendingCount,
    inconsistencyCount: pending.inconsistentOrigins.length +
      duplicateItemCount + consolidation.products.filter((product) => {
        const total = product.sources.reduce((sum, source) => sum + source.quantity, 0);
        return product.sources.length === 0 || Math.abs(total - product.totalQuantity) > 0.0005;
      }).length,
  };

  return { canGenerate: blockers.length === 0, blockers, indicators };
}
