/**
 * Price Resolver — central, deterministic price resolution.
 *
 * Goal: provide a SINGLE place that decides the final unit price of a
 * product given the four sources of truth that exist in the schema:
 *
 *   1. products.basePrice              (catalog default)
 *   2. productSubCategories.price      (variant override, e.g. "higienizado")
 *   3. priceGroups (taxa administrativa) → markup % applied on top
 *   4. contractScopes.unitPrice        (per-customer contractual override)
 *
 * Priority (highest wins):
 *   contractPrice  >  subCategoryPrice  >  basePrice
 * Then (always last):
 *   apply priceGroupMarkup (%) on the chosen price.
 *
 * IMPORTANT — current rollout phase:
 * This module is intentionally NOT wired into any code path that mutates
 * data. It is imported by `products.service.ts` and `orders.service.ts`
 * for divergence logging / future activation only. No endpoint, response
 * shape, or persisted value depends on it yet.
 *
 * FUTURE:
 *   - enableCategoryPricing flag    (toggles subCategoryPrice priority)
 *   - enableAdminMarkup flag        (toggles priceGroupMarkup application)
 *   - enableContractOverride flag   (toggles contractPrice priority)
 */

export interface ResolveProductPriceParams {
  basePrice: number;
  subCategoryPrice?: number | null;
  priceGroupMarkup?: number | null;
  contractPrice?: number | null;
}

export function resolveProductPrice({
  basePrice,
  subCategoryPrice,
  priceGroupMarkup,
  contractPrice,
}: ResolveProductPriceParams): number {
  let price = basePrice;

  if (contractPrice != null) {
    price = contractPrice;
  } else if (subCategoryPrice != null) {
    price = subCategoryPrice;
  }

  if (priceGroupMarkup != null) {
    price = price * (1 + priceGroupMarkup / 100);
  }

  return Number(price.toFixed(2));
}

/**
 * Helper for divergence logging during the read-only rollout phase.
 * Emits a console.warn ONLY when the resolver disagrees with the legacy
 * value already computed by the caller. Does not throw, does not mutate.
 */
export function logPriceDivergence(
  context: string,
  legacy: number,
  resolved: number,
  meta?: Record<string, unknown>,
): void {
  if (Number.isFinite(legacy) && Number.isFinite(resolved) && legacy !== resolved) {
    console.warn("[priceResolver] divergence", {
      context,
      legacy,
      resolved,
      ...meta,
    });
  }
}
