/**
 * buildOrderCatalog — SINGLE SOURCE OF TRUTH for catalog expansion.
 *
 * Shared between create-order.tsx and edit-order.tsx.
 * Guarantees that both screens use the exact same pricing logic:
 *   • expands product.subCategories → one entry per active sub-category
 *   • falls back to a single product entry when no sub-categories exist
 *   • always calls resolvePrice() with the same argument shape
 *   • skips entries where resolvePrice() returns 0 (not commercially priced)
 *
 * Input: products already filtered for availability (active, day gate, etc.)
 *        — this function does NOT apply availability filters itself.
 * Output: flat list of ProductEntry, one row per purchasable SKU.
 */

import { resolvePrice } from "@/utils/priceResolver";

export type ProductEntry = {
  cartKey: string;       // "sc_<subCategoryId>" | "p_<productId>"
  productId: number;
  name: string;
  unit: string;
  observation?: string | null;
  category: string;
  price: number;         // resolved current price
  subCategoryId?: number;
  subCategoryName?: string;
};

type CompanyPricingContext = {
  adminFee?: number | string | null;
  useNewPricing?: boolean;
};

/**
 * Expand a list of pre-filtered products into a flat list of ProductEntry.
 *
 * @param products   Products already gated by availability (active, day, etc.)
 * @param company    Company pricing context (adminFee, useNewPricing)
 * @returns          Flat list, ready to render in catalog or cart
 */
export function buildOrderCatalog(
  products: any[],
  company: CompanyPricingContext | null | undefined,
): ProductEntry[] {
  if (!products || !company) return [];

  const entries: ProductEntry[] = [];

  for (const p of products) {
    const subCats: Array<{ id: number; categoryName: string; price: number; active: boolean }> =
      ((p as any).subCategories ?? []).filter((sc: any) => sc.active !== false);

    if (subCats.length > 0) {
      // One entry per active sub-category
      for (const sc of subCats) {
        const price = resolvePrice({
          basePrice: p.basePrice,
          subCategoryPrice: sc.price,
          contractPrice: (p as any).contractPrice,
          adminFee: company.adminFee,
          useNewPricing: company.useNewPricing === true,
          pricingMode: (p as any).pricingMode,
        });
        if (price <= 0) continue;
        entries.push({
          cartKey: `sc_${sc.id}`,
          productId: p.id,
          name: p.name,
          unit: p.unit ?? "un",
          observation: (p as any).observation,
          category: sc.categoryName,
          price,
          subCategoryId: sc.id,
          subCategoryName: sc.categoryName,
        });
      }
    } else {
      // Single entry using product-level pricing
      const price = resolvePrice({
        basePrice: p.basePrice,
        subCategoryPrice: (p as any).subCategoryPrice,
        contractPrice: (p as any).contractPrice,
        adminFee: company.adminFee,
        useNewPricing: company.useNewPricing === true,
        pricingMode: (p as any).pricingMode,
      });
      if (price <= 0) continue;
      entries.push({
        cartKey: `p_${p.id}`,
        productId: p.id,
        name: p.name,
        unit: p.unit ?? "un",
        observation: (p as any).observation,
        category: p.category ?? "",
        price,
      });
    }
  }

  return entries;
}

/**
 * Map an order item to its canonical cartKey.
 * Mirrors the key format used in create-order.tsx (handleReplicateLastOrder).
 */
export function itemToCartKey(item: { productId: number | string; subCategoryId?: number | string | null }): string {
  return item.subCategoryId
    ? `sc_${item.subCategoryId}`
    : `p_${Number(item.productId)}`;
}
