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
  imageUrl?: string | null;
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
  // ── AUDIT LOG ─────────────────────────────────────────────────────────────
  console.log("[buildOrderCatalog] ▶ iniciando", {
    produtosRecebidos: products?.length ?? 0,
    company: company
      ? { adminFee: company.adminFee, useNewPricing: company.useNewPricing }
      : null,
  });

  if (!products || !company) {
    console.warn("[buildOrderCatalog] ✖ retorno antecipado — products ou company é null/undefined", {
      products: products == null ? "NULL" : `array(${products.length})`,
      company: company == null ? "NULL" : "presente",
    });
    return [];
  }

  const entries: ProductEntry[] = [];
  const descartados: Array<{
    produtoId: number; produtoNome: string;
    scId?: number; scNome?: string;
    basePrice: unknown; subCategoryPrice: unknown;
    contractPriceEnviado: unknown; priceResolvido: number; motivo: string;
  }> = [];

  for (const p of products) {
    const subCats: Array<{ id: number; categoryName: string; price: number; active: boolean }> =
      ((p as any).subCategories ?? []).filter((sc: any) => sc.active !== false);

    if (subCats.length > 0) {
      // One entry per active sub-category.
      // When the sub-category has its own price (sc.price > 0), contractPrice
      // must NOT be forwarded — it would win the contract > sub priority chain
      // and hide the category-specific price entirely.
      // contractPrice is only relevant for products without category pricing.
      for (const sc of subCats) {
        const contractEnviado = sc.price > 0 ? null : (p as any).contractPrice;
        const price = resolvePrice({
          basePrice: p.basePrice,
          subCategoryPrice: sc.price,
          contractPrice: contractEnviado,
          adminFee: company.adminFee,
          useNewPricing: company.useNewPricing === true,
          pricingMode: (p as any).pricingMode,
        });

        // ── log por sub-categoria ─────────────────────────────────────────
        console.log("[buildOrderCatalog] produto+subcat", {
          produto: { id: p.id, nome: p.name },
          subCategory: { id: sc.id, nome: sc.categoryName, "sc.price": sc.price },
          contractPriceEnviado: contractEnviado,
          basePrice: p.basePrice,
          pricingMode: (p as any).pricingMode ?? "undefined",
          precoResolvido: price,
          acao: price <= 0 ? "DESCARTADO (price <= 0)" : "INCLUÍDO",
        });

        if (price <= 0) {
          descartados.push({
            produtoId: p.id, produtoNome: p.name,
            scId: sc.id, scNome: sc.categoryName,
            basePrice: p.basePrice, subCategoryPrice: sc.price,
            contractPriceEnviado: contractEnviado, priceResolvido: price,
            motivo: "resolvePrice() retornou 0 ou negativo",
          });
          continue;
        }

        entries.push({
          cartKey: `sc_${sc.id}`,
          productId: p.id,
          name: p.name,
          unit: p.unit ?? "un",
          imageUrl: (p as any).imageUrl,
          observation: (p as any).observation,
          category: sc.categoryName,
          price,
          subCategoryId: sc.id,
          subCategoryName: sc.categoryName,
        });
      }
    } else {
      // Single entry using product-level pricing
      const subCategoryPriceP = (p as any).subCategoryPrice;
      const contractPriceP    = (p as any).contractPrice;
      const price = resolvePrice({
        basePrice: p.basePrice,
        subCategoryPrice: subCategoryPriceP,
        contractPrice: contractPriceP,
        adminFee: company.adminFee,
        useNewPricing: company.useNewPricing === true,
        pricingMode: (p as any).pricingMode,
      });

      // ── log produto sem sub-categorias ───────────────────────────────────
      console.log("[buildOrderCatalog] produto sem subcat", {
        produto: { id: p.id, nome: p.name },
        subCategoryPrice: subCategoryPriceP,
        contractPrice: contractPriceP,
        basePrice: p.basePrice,
        pricingMode: (p as any).pricingMode ?? "undefined",
        precoResolvido: price,
        acao: price <= 0 ? "DESCARTADO (price <= 0)" : "INCLUÍDO",
      });

      if (price <= 0) {
        descartados.push({
          produtoId: p.id, produtoNome: p.name,
          basePrice: p.basePrice, subCategoryPrice: subCategoryPriceP,
          contractPriceEnviado: contractPriceP, priceResolvido: price,
          motivo: "resolvePrice() retornou 0 ou negativo (sem subcat)",
        });
        continue;
      }

      entries.push({
        cartKey: `p_${p.id}`,
        productId: p.id,
        name: p.name,
        unit: p.unit ?? "un",
        imageUrl: (p as any).imageUrl,
        observation: (p as any).observation,
        category: p.category ?? "",
        price,
      });
    }
  }

  // ── RESUMO FINAL ──────────────────────────────────────────────────────────
  console.log("[buildOrderCatalog] ◀ resumo", {
    produtosRecebidos: products.length,
    entriesCriadas: entries.length,
    descartados: descartados.length,
  });

  if (descartados.length > 0) {
    console.warn("[buildOrderCatalog] ⚠ itens descartados (price <= 0):", descartados);
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
