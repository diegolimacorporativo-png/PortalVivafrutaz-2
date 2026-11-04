export type ProductIdentityStatus = "exact" | "confirmed" | "probable" | "unmatched" | "ambiguous";

export interface ProductIdentityCandidate {
  id: number;
  name: string;
  category?: string | null;
  unit?: string | null;
  observation?: string | null;
  productCode?: string | null;
  active?: boolean;
  productionClassification?: "IN_NATURA" | "PROCESSADOS" | null;
}

export interface ProductAliasCandidate {
  productId: number;
  companyId?: number | null;
  alias: string;
  normalizedAlias?: string;
  status?: string;
}

export interface ProductIdentityInput {
  description: string;
  companyId?: number | null;
  category?: string | null;
  unit?: string | null;
}

export interface ProductIdentityResult {
  status: ProductIdentityStatus;
  product: ProductIdentityCandidate | null;
  candidates: Array<ProductIdentityCandidate & { confidence: number }>;
  matchedBy?: "catalog_name" | "company_alias" | "global_alias";
}

/** Normalize spelling only; this never authorizes a fuzzy match. */
export function normalizeProductDescription(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Keep trusted source wording for history, falling back to catalog at write time. */
export function makeSourceDescriptionSnapshot(
  sourceDescription: unknown,
  canonicalName: unknown,
): string | null {
  const source = typeof sourceDescription === "string" ? sourceDescription.trim() : "";
  const canonical = typeof canonicalName === "string" ? canonicalName.trim() : "";
  return (source || canonical).slice(0, 500) || null;
}

function metadataMatches(input: ProductIdentityInput, product: ProductIdentityCandidate): boolean {
  if (input.category && normalizeProductDescription(input.category) !== normalizeProductDescription(product.category)) {
    return false;
  }
  if (input.unit && normalizeProductDescription(input.unit) !== normalizeProductDescription(product.unit)) {
    return false;
  }
  return true;
}

function tokenSimilarity(left: string, right: string): number {
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  return overlap / new Set([...a, ...b]).size;
}

function result(
  status: ProductIdentityStatus,
  product: ProductIdentityCandidate | null = null,
  matchedBy?: ProductIdentityResult["matchedBy"],
  candidates: ProductIdentityResult["candidates"] = [],
): ProductIdentityResult {
  return { status, product, candidates, ...(matchedBy ? { matchedBy } : {}) };
}

/**
 * Resolves only an exact catalog name or a human-confirmed alias. Similarity
 * scores are returned as review suggestions and can never identify a product
 * automatically or participate in final production aggregation.
 */
export function resolveProductIdentity(
  input: ProductIdentityInput,
  products: ProductIdentityCandidate[],
  aliases: ProductAliasCandidate[] = [],
): ProductIdentityResult {
  const normalizedDescription = normalizeProductDescription(input.description);
  if (!normalizedDescription) return result("unmatched");

  const available = products.filter((product) => product.active !== false && metadataMatches(input, product));
  const productById = new Map(available.map((product) => [product.id, product]));
  // Fail closed: aliases without an explicit confirmed state must never
  // participate in automatic identification.
  const eligibleAliases = aliases.filter((alias) => alias.status === "CONFIRMED");
  const aliasMatches = eligibleAliases.filter((alias) => {
    const companyMatch = input.companyId != null && alias.companyId === input.companyId;
    const globalMatch = alias.companyId == null;
    return (companyMatch || globalMatch) &&
      (alias.normalizedAlias || normalizeProductDescription(alias.alias)) === normalizedDescription;
  });
  const aliasProductIds = [...new Set(aliasMatches.map((alias) => alias.productId))];

  // Official catalog names have priority. If a legacy or concurrently-created
  // alias points that exact name at a different product, fail closed instead
  // of silently redirecting the canonical identity.
  const exactMatches = available.filter(
    (product) => normalizeProductDescription(product.name) === normalizedDescription,
  );
  const exactIds = [...new Set(exactMatches.map((product) => product.id))];
  if (exactIds.length > 1) return result("ambiguous");
  if (exactIds.length === 1) {
    if (aliasProductIds.some((productId) => productId !== exactIds[0])) return result("ambiguous");
    return result("exact", exactMatches.find((product) => product.id === exactIds[0])!, "catalog_name");
  }

  if (aliasProductIds.length > 1) return result("ambiguous");
  if (aliasProductIds.length === 1) {
    const product = productById.get(aliasProductIds[0]!);
    if (product) {
      const matchedBy = aliasMatches.some((alias) => alias.companyId === input.companyId && input.companyId != null)
        ? "company_alias"
        : "global_alias";
      return result("confirmed", product, matchedBy);
    }
  }

  const suggestions = available
    .map((product) => ({
      ...product,
      confidence: tokenSimilarity(normalizedDescription, normalizeProductDescription(product.name)),
    }))
    .filter((product) => product.confidence >= 0.34)
    .sort((a, b) => b.confidence - a.confidence || a.id - b.id)
    .slice(0, 5);
  if (suggestions.length) return result("probable", null, undefined, suggestions);
  return result("unmatched");
}
