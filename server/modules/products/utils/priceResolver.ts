/**
 * Price Resolver — central, deterministic price resolution.
 *
 * Goal: provide a SINGLE place that decides the final unit price of a
 * product given the four sources of truth that exist in the schema:
 *
 *   1. products.basePrice              (catalog default, fallback)
 *   2. productSubCategories.price      (variant override, e.g. "higienizado")
 *   3. contractScopes.unitPrice        (per-customer contractual override)
 *   4. companies.adminFee              (% applied on top of the chosen price)
 *
 * Priority for the SOURCE price (highest wins):
 *   contractPrice  >  subCategoryPrice  >  basePrice
 * Then (always last):
 *   apply adminFee (%) on the chosen source.
 *
 * Final formula:
 *   resolvedPrice = sourcePrice * (1 + adminFee / 100)
 *   (rounded to 2 decimals)
 *
 * IMPORTANT — current rollout phase:
 * This module is intentionally NOT wired into any code path that mutates
 * data. It is imported by `products.service.ts` and `orders.service.ts`
 * for divergence logging / future activation only. No endpoint, response
 * shape, or persisted value depends on it yet.
 *
 * FUTURE:
 *   - enableCategoryPricing flag    (toggles subCategoryPrice priority)
 *   - enableAdminMarkup flag        (toggles adminFee application)
 *   - enableContractOverride flag   (toggles contractPrice priority)
 *
 * Properties:
 *   - pure function (no I/O, no DB, no clock)
 *   - deterministic
 *   - safe with NaN / Infinity / null / undefined
 *   - 0 is treated as a VALID override price (only null/undefined skip it)
 */

export interface ResolveProductPriceParams {
  /** Catalog default price for the product. Required. */
  basePrice: number;
  /** Variant price (e.g. "higienizado"). 0 is a valid override. */
  subCategoryPrice?: number | null;
  /** Per-customer contractual override. 0 is a valid override. */
  contractPrice?: number | null;
  /** Customer-level administrative fee, in percent (e.g. 10 = +10%). */
  adminFee?: number | null;
  /**
   * @deprecated Use `adminFee`. Kept ONLY as a backwards-compatible alias
   * for callers instrumented in earlier rollout steps. New code MUST use
   * `adminFee` to align with the `companies.adminFee` schema column.
   */
  priceGroupMarkup?: number | null;
}

export function resolveProductPrice(input: ResolveProductPriceParams): number {
  const { basePrice, subCategoryPrice, contractPrice } = input;
  // Accept either `adminFee` (canonical) or `priceGroupMarkup` (legacy alias).
  const adminFeeRaw =
    input.adminFee != null ? input.adminFee : input.priceGroupMarkup;

  // STEP 1 — pick the source price.
  // Priority: contractPrice > subCategoryPrice > basePrice.
  // Note: 0 is a VALID override; only null / undefined are skipped.
  let sourcePrice: number = basePrice;
  if (contractPrice != null) {
    sourcePrice = contractPrice;
  } else if (subCategoryPrice != null) {
    sourcePrice = subCategoryPrice;
  }

  // STEP 2 — defensive validation of the chosen source.
  if (!Number.isFinite(sourcePrice)) {
    return 0;
  }

  // STEP 3 — apply the admin fee.
  // null / undefined / NaN / Infinity → treated as 0 (no markup).
  const fee =
    adminFeeRaw != null && Number.isFinite(adminFeeRaw)
      ? Number(adminFeeRaw)
      : 0;

  const final = sourcePrice * (1 + fee / 100);

  // STEP 4 — final safety net + 2-decimal rounding.
  if (!Number.isFinite(final)) {
    return Number(sourcePrice.toFixed(2));
  }
  return Number(final.toFixed(2));
}

/**
 * Context for a divergence-log event.
 * `requestId` is optional and will be rendered as a `[<reqId>]` prefix
 * to match the rest of the application's log format.
 */
export interface PriceDivergenceContext {
  scope: string;                // e.g. "orders.service"
  method: string;               // e.g. "createWithDelivery"
  productId?: number | null;
  companyId?: number | null;
  requestId?: string | null;
}

/**
 * Helper for divergence logging during the read-only rollout phase.
 * Emits a console.warn ONLY when the resolver disagrees with the legacy
 * value already computed by the caller. Never throws, never mutates.
 *
 * Output format (preserved across rollout steps for grep stability):
 *   [<reqId>] [priceResolver] divergence detected {
 *     scope, method, legacy, resolved, productId, companyId, ...meta
 *   }
 *
 * Accepts either the structured context object (preferred) or a plain
 * string for backwards compatibility with very early callers.
 */
export function logPriceDivergence(
  context: PriceDivergenceContext | string,
  legacy: number,
  resolved: number,
  meta?: Record<string, unknown>,
): void {
  try {
    if (
      !Number.isFinite(legacy) ||
      !Number.isFinite(resolved) ||
      legacy === resolved
    ) {
      return;
    }
    const ctx: PriceDivergenceContext =
      typeof context === "string"
        ? { scope: context, method: "" }
        : context;
    const prefix = ctx.requestId ? `[${ctx.requestId}] ` : "";
    console.warn(`${prefix}[priceResolver] divergence detected`, {
      scope: ctx.scope,
      method: ctx.method,
      legacy,
      resolved,
      productId: ctx.productId ?? undefined,
      companyId: ctx.companyId ?? undefined,
      ...meta,
    });
  } catch {
    // logger must NEVER affect the request flow
  }
}
