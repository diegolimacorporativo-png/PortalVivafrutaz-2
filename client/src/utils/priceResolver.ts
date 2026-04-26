/**
 * Frontend Price Resolver — STEP 4.
 *
 * Single source of truth for the unit price displayed in the UI.
 *
 * Priority for the SOURCE price (highest wins):
 *   contractPrice  >  subCategoryPrice  >  basePrice
 *
 * Then, ONLY when the company has the `useNewPricing` flag enabled, the
 * `adminFee` (in percent) is applied on top. The fee is NEVER shown to
 * the customer — it just changes the final number that appears on screen.
 *
 * Pure function, deterministic, safe with NaN / Infinity / null /
 * undefined / strings (numeric columns from drizzle arrive as strings).
 */
export interface ResolvePriceInput {
  basePrice?: number | string | null;
  subCategoryPrice?: number | string | null;
  contractPrice?: number | string | null;
  adminFee?: number | string | null;
  useNewPricing?: boolean;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function resolvePrice({
  basePrice,
  subCategoryPrice,
  contractPrice,
  adminFee,
  useNewPricing,
}: ResolvePriceInput): number {
  const contract = toNum(contractPrice);
  const sub = toNum(subCategoryPrice);
  const base = toNum(basePrice);

  // Priority: contract > sub-category > base. 0 is a valid override —
  // only null/undefined falls through to the next source.
  let price: number = contract ?? sub ?? base ?? 0;

  if (useNewPricing === true) {
    const fee = toNum(adminFee);
    if (fee !== null && fee !== 0) {
      price = price * (1 + fee / 100);
    }
  }

  if (!Number.isFinite(price) || price < 0) return 0;
  return Number(price.toFixed(2));
}

/**
 * Convenience helper: returns "—" when the resolved price is 0/missing,
 * otherwise the BRL-formatted string. Used by tables and product cards
 * so the visual fallback is consistent everywhere.
 */
export function formatPriceOrDash(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "—";
  return `R$ ${price.toFixed(2)}`;
}

/**
 * Tells the UI which source of truth produced the resolved price, so an
 * admin badge ("Categoria" / "Contrato") can be rendered next to it.
 * Returns "base" by default.
 */
export function priceSource(input: ResolvePriceInput): "contract" | "subcategory" | "base" {
  if (toNum(input.contractPrice) !== null) return "contract";
  if (toNum(input.subCategoryPrice) !== null) return "subcategory";
  return "base";
}
