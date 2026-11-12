export interface ProductionExportSource {
  itemId?: number;
  orderId: number;
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
}

export interface ProductionExportItem {
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
}

export type HeaderResolution =
  | { column: number; status: "matched" }
  | { status: "unmatched" | "ambiguous" };

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
    .replace(/\b(?:biodegradavel|bio|plastico|pouch|pote|embalagem)\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
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
): HeaderResolution {
  const normalizedProduct = normalize(productName);
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

  if (matching.length === 0) return { status: "unmatched" };
  if (matching.length !== 1) return { status: "ambiguous" };
  return { column: matching[0].column, status: "matched" };
}

export type ProcessedPackaging = "BIO_100G" | "P07_PLASTIC_100G" | "POT_200G" | "PET" | "KG";

/** P07 means plastic, while Bio means biodegradable; never infer either from productId alone. */
export function classifyProcessedPackaging(
  subCategoryName: string | null | undefined,
  categoryName?: string | null,
  productName?: string | null,
): ProcessedPackaging | null {
  const value = subCategoryName ?? "";
  const category = categoryName ?? "";
  const normalizedProduct = normalize(productName ?? "");
  const processedPlastic = hasPlasticMarker(value) || hasPlasticMarker(category);
  // The approved catalog item is a 170g plastic fruit-and-yogurt pot; the
  // official Processados template places that exact item in the PET block.
  if ((normalizedProduct === "de manga e iogurte grego" || normalizedProduct === "manga e iogurte grego") && processedPlastic) return "PET";
  if (hasBioMarker(value)) return /100\s*g/i.test(value) ? "BIO_100G" : null;
  if (hasPlasticMarker(value) || hasPlasticMarker(category)) {
    const packagingDescription = `${value} ${category}`;
    if (/\bpet\b/i.test(packagingDescription)) return "PET";
    return /100\s*g/i.test(packagingDescription) ? "P07_PLASTIC_100G" : null;
  }
  if (/\bpet\b/i.test(value)) return "PET";
  if (/200\s*g/i.test(value)) return "POT_200G";
  if (/\bkg\b/i.test(value)) return "KG";
  return null;
}
