export interface ProductionExportSource {
  itemId?: number;
  orderId?: number | null;
  orderCode?: string | null;
  companyId: number;
  companyName: string;
  quantity: number;
  routeName?: string | null;
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
  manualExportHeader?: string;
  manualPackaging?: ProcessedPackaging;
  /** Catalog flag captured in the immutable batch source snapshot. */
  isIndustrialized?: boolean;
  manualMappingAudit?: { userId: number; at: string; justification: string };
  sourceType?: "ORDER" | "MANUAL_PRODUCTION";
  manualReference?: string | null;
  requestId?: string;
}

export interface ProductionExportItem {
  batchItemId?: number;
  productId: number;
  productName: string;
  category?: string | null;
  unit: string;
  productionClassification: "IN_NATURA" | "PROCESSADOS";
  totalQuantity: string | number;
  orderBreakdown: ProductionExportSource[];
}

export interface ProductionExportBatch {
  id: number;
  productionDate: string;
  items: ProductionExportItem[];
}

export interface HeaderCandidate {
  column: number;
  header: string;
  hygieneStatus?: HygieneStatus | "CONFLICT";
}

export type HygieneStatus = "HIGIENIZADA" | "NAO_HIGIENIZADA";

export type HeaderResolution =
  | { column: number; status: "matched" }
  | { status: "unmatched" | "ambiguous" };

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
    .replace(/\b(?:nao|sem)\s+higienizad[oa]s?\b/g, " ")
    .replace(/\bhigienizad[oa]s?\b/g, " ")
    .replace(/\bnao\b/g, " ")
    .replace(/\b(?:biodegradavel|bio|plastico|pouch|pote|embalagem)\b/g, " ")
    .replace(/\b(?:kg|un|unidade|unidades)\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/**
 * The official In Natura template uses green for non-hygienized produce and
 * light blue for hygienized produce. Text markers take precedence only when
 * they agree with the template color; conflicting evidence fails closed.
 */
export function resolveHygieneStatus(
  description: string | null | undefined,
  fillColor?: string | null,
): HygieneStatus | "CONFLICT" | null {
  const normalized = (description ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
  const textSaysUnhygienized = /\b(?:nao|sem) higienizad[oa]s?\b/.test(normalized);
  const withoutNegativeMarker = normalized.replace(/\b(?:nao|sem) higienizad[oa]s?\b/g, " ");
  const textSaysHygienized = /\bhigienizad[oa]s?\b/.test(withoutNegativeMarker);
  if (textSaysUnhygienized && textSaysHygienized) return "CONFLICT";
  const textStatus: HygieneStatus | null = textSaysUnhygienized
    ? "NAO_HIGIENIZADA"
    : textSaysHygienized
      ? "HIGIENIZADA"
      : null;
  const color = (fillColor ?? "").replace(/^#/, "").toUpperCase();
  const shortColor = color.length === 8 ? color.slice(2) : color;
  const colorStatus: HygieneStatus | null = shortColor === "99FF99"
    ? "NAO_HIGIENIZADA"
    : shortColor === "DBEEF4"
      ? "HIGIENIZADA"
      : null;

  if (textStatus && colorStatus && textStatus !== colorStatus) return "CONFLICT";
  return textStatus ?? colorStatus;
}

// Reviewed exact alias from the current catalog to the official In Natura header.
const IN_NATURA_HEADER_ALIASES: Readonly<Record<string, string>> = {
  "pessego nacional inicio safra": "pessego",
};

function hasBioMarker(value: string): boolean {
  return /\b(?:bio|biodegrad[aá]vel)\b/i.test(value);
}

function hasPlasticMarker(value: string): boolean {
  return /\b(?:p07|pl[aá]stic[oa])\b/i.test(value);
}

function weightMarker(value: string): string | null {
  return value.toLocaleLowerCase("pt-BR").match(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l)\b/)?.[0].replace(/\s+/g, "") ?? null;
}

/** Exact normalized identity only; ambiguous duplicate template headers are rejected. */
export function resolveInNaturaHeader(
  productName: string,
  subCategoryName: string | null | undefined,
  candidates: HeaderCandidate[],
  productCategory?: string | null,
): HeaderResolution {
  const normalizedProduct = normalize(productName);
  const sourceHygiene = resolveHygieneStatus(`${productName} ${subCategoryName ?? ""} ${productCategory ?? ""}`);
  if (sourceHygiene === "CONFLICT") return { status: "ambiguous" };

  // Reviewed business mapping: "Porção de Morango" targets the conventional
  // 50g column, not the separate biodegradable Bio column.
  if (normalizedProduct === "porcao de morango") {
    let matching = candidates.filter((candidate) =>
      normalize(candidate.header) === "morango" &&
      weightMarker(candidate.header) === "50g" &&
      !hasBioMarker(candidate.header),
    );
    if (matching.length === 0) return { status: "unmatched" };
    if (matching.some((candidate) => candidate.hygieneStatus === "CONFLICT")) return { status: "ambiguous" };
    // Hygiene color is only a discriminator when the official model has
    // multiple otherwise-identical columns. A unique official Morango 50g
    // column must remain usable even if the catalog category mentions hygiene.
    if (matching.length > 1 && sourceHygiene) {
      matching = matching.filter((candidate) => candidate.hygieneStatus === sourceHygiene);
    }
    if (matching.length !== 1) return { status: "ambiguous" };
    return { column: matching[0].column, status: "matched" };
  }
  const productKey = IN_NATURA_HEADER_ALIASES[normalizedProduct] ?? normalizedProduct;
  if (!productKey) return { status: "unmatched" };
  let matching = candidates.filter((candidate) => normalize(candidate.header) === productKey);

  // Packaging markers are discriminators only when the official header itself
  // explicitly records that marker. Never infer a plastic/Bio column by name.
  const subcategory = subCategoryName ?? "";
  if (hasBioMarker(subcategory)) matching = matching.filter((candidate) => hasBioMarker(candidate.header));
  if (hasPlasticMarker(subcategory)) {
    const explicitlyPlastic = matching.filter((candidate) => hasPlasticMarker(candidate.header));
    matching = explicitlyPlastic.length ? explicitlyPlastic : matching.filter((candidate) => !hasBioMarker(candidate.header));
  }
  const sourceWeight = weightMarker(subcategory);
  if (sourceWeight) matching = matching.filter((candidate) => weightMarker(candidate.header) === sourceWeight);

  // The green/blue convention distinguishes hygiene only where the template
  // repeats the same product. It must not reject a unique official column
  // (for example PÊSSEGO or Kiwi) because its fill is neutral or differs from
  // a broad catalog category label.
  if (matching.length > 1 && sourceHygiene) {
    matching = matching.filter((candidate) => candidate.hygieneStatus === sourceHygiene);
  }

  if (matching.length === 0) return { status: "unmatched" };
  if (matching.some((candidate) => candidate.hygieneStatus === "CONFLICT")) return { status: "ambiguous" };
  if (matching.length !== 1) return { status: "ambiguous" };
  return { column: matching[0].column, status: "matched" };
}

export type ProcessedPackaging = "BIO_100G" | "P07_PLASTIC_100G" | "POT_200G" | "PET" | "KG";

/** P07 means plastic, while Bio means biodegradable; never infer either from productId alone. */
export function classifyProcessedPackaging(
  subCategoryName: string | null | undefined,
  categoryName?: string | null,
  _productName?: string | null,
): ProcessedPackaging | null {
  const value = subCategoryName ?? "";
  const category = categoryName ?? "";
  const packagingDescription = `${value} ${category}`;
  const bio = hasBioMarker(packagingDescription);
  const p07 = /\bp07\b/i.test(packagingDescription);
  const plastic = hasPlasticMarker(packagingDescription);
  const pet = /\bpet\b/i.test(packagingDescription);
  const weights = [...new Set((packagingDescription.toLocaleLowerCase("pt-BR").match(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l)\b/g) ?? [])
    .map((weight) => weight.replace(/\s+/g, "")))];
  if (weights.length > 1) return null;
  const weight = weights[0] ?? null;

  // Conflicting package markers must be reviewed instead of guessed.
  if (Number(bio) + Number(p07) + Number(pet) > 1) return null;
  if (bio) return weight === "100g" ? "BIO_100G" : null;
  if (pet) return "PET";
  if (p07) {
    // P07 is a plastic package, but the supported P07 block is specifically
    // 100g. A 200g P07 must not be silently written into that block.
    if (weight !== "100g") return null;
    return "P07_PLASTIC_100G";
  }
  if (plastic && weight === "100g") return "P07_PLASTIC_100G";
  if (weight === "200g") return "POT_200G";
  if (weight === "kg") return "KG";
  return null;
}
