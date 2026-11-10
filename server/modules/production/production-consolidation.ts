import { isProductionOrderEligible, type ProductionOrderOrigin } from "./production-eligibility";

export interface ProductionConsolidationSource {
  itemId: number;
  orderId: number;
  orderCode: string | null;
  companyId: number;
  companyName: string;
  deliveryDate: string | Date;
  productId: number | null;
  productName: string | null;
  category: string | null;
  unit: string | null;
  productionClassification: "IN_NATURA" | "PROCESSADOS" | null;
  sourceDescriptionSnapshot?: string | null;
  subCategoryId?: number | null;
  subCategoryName?: string | null;
  deliveryAddressId?: number | null;
  deliveryAddress?: {
    id: number;
    companyId: number;
    label: string;
    logradouro: string;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string;
    estado: string | null;
    cep: string | null;
  } | null;
  quantity: number;
  workflowStatus: string;
  productionOrigin: ProductionOrderOrigin;
  specialRequestApprovedAndMaterialized: boolean;
  contractOccurrenceValid: boolean;
}

export interface ProductionSourceBreakdown {
  itemId: number;
  orderId: number;
  orderCode: string;
  companyId: number;
  companyName: string;
  deliveryDate: string;
  quantity: number;
  origin: Exclude<ProductionOrderOrigin, null>;
  routeId: number | null;
  routeName: string;
  subCategoryId?: number | null;
  subCategoryName?: string | null;
  deliveryAddressId?: number | null;
  deliveryAddress?: ProductionConsolidationSource["deliveryAddress"];
}

export interface MissingContractOccurrence {
  companyId: number;
  companyName: string;
  contractId: number;
  contractScopeId: number;
  productId: number;
  productName: string | null;
  quantity: number;
  deliveryDate: string;
  reason: string;
}

export interface ProductionConsolidation {
  productionDate: string;
  products: Array<{
    productId: number;
    productName: string;
    category: string | null;
    subCategoryId: number | null;
    subCategoryName: string | null;
    productionClassification: "IN_NATURA" | "PROCESSADOS";
    unit: string;
    totalQuantity: number;
    sources: ProductionSourceBreakdown[];
    routeBreakdown: Array<{
      routeId: number | null;
      routeName: string;
      quantity: number;
      companies: Array<{ companyId: number; companyName: string; quantity: number }>;
    }>;
  }>;
  pending: {
    missingContractOccurrences: MissingContractOccurrence[];
    unidentifiedItems: Array<{
      itemId: number; orderId: number; orderCode: string | null; companyId: number;
      companyName: string; sourceDescription: string | null; quantity: number; reason: string;
    }>;
    unclassifiedItems: Array<{
      itemId: number; orderId: number; orderCode: string | null; companyId: number;
      companyName: string; productId: number; productName: string; quantity: number;
    }>;
    ineligibleOrders: Array<{
      orderId: number; orderCode: string | null; companyId: number; companyName: string;
      workflowStatus: string; origin: ProductionOrderOrigin; reason: string;
    }>;
    inconsistentOrigins: Array<{
      orderId: number; orderCode: string | null; companyId: number; companyName: string;
      origin: ProductionOrderOrigin; itemId: number; reason: string;
    }>;
  };
}

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/** Consolidates only trusted, eligible materialized order items. */
export function consolidateProduction(
  productionDate: string,
  rows: ProductionConsolidationSource[],
  routes: Array<{ id: number; name: string; companyIds: number[] }>,
  missingContractOccurrences: MissingContractOccurrence[] = [],
): ProductionConsolidation {
  const routeByCompany = new Map<number, { id: number; name: string }>();
  for (const route of routes) {
    for (const companyId of route.companyIds) {
      if (!routeByCompany.has(companyId)) routeByCompany.set(companyId, { id: route.id, name: route.name });
    }
  }

  const productGroups = new Map<string, ProductionConsolidation["products"][number]>();
  const ineligible = new Map<number, ProductionConsolidation["pending"]["ineligibleOrders"][number]>();
  const inconsistent: ProductionConsolidation["pending"]["inconsistentOrigins"] = [];
  const unidentified: ProductionConsolidation["pending"]["unidentifiedItems"] = [];
  const unclassified: ProductionConsolidation["pending"]["unclassifiedItems"] = [];

  for (const row of rows) {
    if (dateOnly(row.deliveryDate) !== productionDate) {
      ineligible.set(row.orderId, {
        orderId: row.orderId, orderCode: row.orderCode, companyId: row.companyId,
        companyName: row.companyName, workflowStatus: row.workflowStatus,
        origin: row.productionOrigin, reason: "DATA_DIVERGENTE_DA_PRODUCAO_SOLICITADA",
      });
      continue;
    }
    const eligible = isProductionOrderEligible({
      workflowStatus: row.workflowStatus,
      origin: row.productionOrigin,
      contractOccurrenceValid: row.contractOccurrenceValid,
      specialRequestApprovedAndMaterialized: row.specialRequestApprovedAndMaterialized,
    });
    if (!eligible) {
      const reason = row.productionOrigin === "CONTRACT_FIXED" && !row.contractOccurrenceValid
        ? "ORIGEM_CONTRATUAL_NAO_COMPROVADA"
        : row.productionOrigin === "SPECIAL" && !row.specialRequestApprovedAndMaterialized
          ? "SOLICITACAO_PONTUAL_SEM_APROVACAO_E_VINCULO"
          : row.productionOrigin === null
            ? "ORIGEM_NAO_COMPROVADA"
            : row.workflowStatus !== "APPROVED"
              ? "PEDIDO_NAO_APROVADO_OU_JA_PROCESSADO"
              : "ORIGEM_OU_STATUS_INVALIDO";
      ineligible.set(row.orderId, {
        orderId: row.orderId,
        orderCode: row.orderCode,
        companyId: row.companyId,
        companyName: row.companyName,
        workflowStatus: row.workflowStatus,
        origin: row.productionOrigin,
        reason,
      });
      if (row.productionOrigin === "CONTRACT_FIXED" || row.productionOrigin === "SPECIAL") {
        inconsistent.push({
          orderId: row.orderId,
          orderCode: row.orderCode,
          companyId: row.companyId,
          companyName: row.companyName,
          origin: row.productionOrigin,
          itemId: row.itemId,
          reason,
        });
      }
      continue;
    }

    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      unidentified.push({
        itemId: row.itemId, orderId: row.orderId, orderCode: row.orderCode,
        companyId: row.companyId, companyName: row.companyName,
        sourceDescription: row.sourceDescriptionSnapshot ?? row.productName,
        quantity: Number.isFinite(quantity) ? quantity : 0,
        reason: "QUANTIDADE_INVALIDA",
      });
      continue;
    }
    if (!row.productId || !row.productName) {
      unidentified.push({
        itemId: row.itemId, orderId: row.orderId, orderCode: row.orderCode,
        companyId: row.companyId, companyName: row.companyName,
        sourceDescription: row.sourceDescriptionSnapshot ?? row.productName,
        quantity,
        reason: "PRODUTO_OFICIAL_NAO_ENCONTRADO",
      });
      continue;
    }
    if (row.productionClassification !== "IN_NATURA" && row.productionClassification !== "PROCESSADOS") {
      unclassified.push({
        itemId: row.itemId, orderId: row.orderId, orderCode: row.orderCode,
        companyId: row.companyId, companyName: row.companyName,
        productId: row.productId, productName: row.productName, quantity,
      });
      continue;
    }

    // Canonical productId and exact catalog unit are both part of the group
    // identity. Aliases have already resolved to productId upstream; fuzzy
    // similarity never merges separate catalog IDs here.
    const unit = String(row.unit ?? "").trim();
    // Preserve packaging/subcategory variants (e.g. Bio vs P07) as distinct
    // production rows while still consolidating identical catalog items.
    // Subcategory IDs can be company-scoped. Consolidate equivalent catalog
    // labels across tenants, while keeping named packaging variants separate.
    let normalizedSubCategory = String(row.subCategoryName ?? "").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
    const packageWeight = normalizedSubCategory.match(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l)\b/)?.[0].replace(/\s+/g, "") ?? "";
    if (/\b(?:bio|biodegradavel)\b/.test(normalizedSubCategory)) normalizedSubCategory = `packaging:bio:${packageWeight}`;
    else if (/\b(?:p07|plastico|plastica)\b/.test(normalizedSubCategory)) normalizedSubCategory = `packaging:plastic:${packageWeight}`;
    const subCategoryKey = normalizedSubCategory || `legacy-id:${row.subCategoryId ?? "none"}`;
    const groupKey = `${row.productId}:${unit}:${subCategoryKey}`;
    const group = productGroups.get(groupKey) ?? {
      productId: row.productId,
      productName: row.productName,
      category: row.category,
      subCategoryId: row.subCategoryId ?? null,
      subCategoryName: row.subCategoryName ?? null,
      productionClassification: row.productionClassification,
      unit,
      totalQuantity: 0,
      sources: [],
      routeBreakdown: [],
    };
    if (group.subCategoryId !== (row.subCategoryId ?? null)) group.subCategoryId = null;
    group.totalQuantity += quantity;
    const route = routeByCompany.get(row.companyId);
    group.sources.push({
      itemId: row.itemId,
      orderId: row.orderId,
      orderCode: row.orderCode ?? `#${row.orderId}`,
      companyId: row.companyId,
      companyName: row.companyName,
      deliveryDate: dateOnly(row.deliveryDate),
      quantity,
      origin: row.productionOrigin!,
      routeId: route?.id ?? null,
      routeName: route?.name ?? "Sem Rota",
      subCategoryId: row.subCategoryId ?? null,
      subCategoryName: row.subCategoryName ?? null,
      deliveryAddressId: row.deliveryAddressId ?? null,
      deliveryAddress: row.deliveryAddress ?? null,
    });
    productGroups.set(groupKey, group);
  }

  const products = Array.from(productGroups.values()).map((group) => {
    group.sources.sort((a, b) => a.companyName.localeCompare(b.companyName) || a.orderId - b.orderId || a.itemId - b.itemId);
    const routeMap = new Map<string, { routeId: number | null; routeName: string; quantity: number; companies: Map<number, { companyId: number; companyName: string; quantity: number }> }>();
    for (const source of group.sources) {
      const key = source.routeId == null ? "none" : String(source.routeId);
      const route = routeMap.get(key) ?? { routeId: source.routeId, routeName: source.routeName, quantity: 0, companies: new Map() };
      route.quantity += source.quantity;
      const company = route.companies.get(source.companyId) ?? { companyId: source.companyId, companyName: source.companyName, quantity: 0 };
      company.quantity += source.quantity;
      route.companies.set(company.companyId, company);
      routeMap.set(key, route);
    }
    group.routeBreakdown = Array.from(routeMap.values()).map((route) => ({
      ...route,
      companies: Array.from(route.companies.values()).sort((a, b) => a.companyName.localeCompare(b.companyName)),
    })).sort((a, b) => a.routeName.localeCompare(b.routeName));
    return group;
  }).sort((a, b) => a.productionClassification.localeCompare(b.productionClassification) || a.productName.localeCompare(b.productName) || a.productId - b.productId);

  return {
    productionDate,
    products,
    pending: {
      missingContractOccurrences,
      unidentifiedItems: unidentified,
      unclassifiedItems: unclassified,
      ineligibleOrders: Array.from(ineligible.values()).sort((a, b) => a.companyName.localeCompare(b.companyName) || a.orderId - b.orderId),
      inconsistentOrigins: inconsistent,
    },
  };
}
