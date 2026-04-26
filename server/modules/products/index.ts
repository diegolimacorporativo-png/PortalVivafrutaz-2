/**
 * Products module — public entry point.
 *
 * Exposes two router definitions:
 *   - `definition`           → mounted at /api/products
 *   - `categoriesDefinition` → mounted at /api/categories
 *
 * The catalog (categories) lives inside the products module because it
 * is part of the same bounded context (product taxonomy) and shares the
 * same controller/service/repository chain.
 */
import { productsRouter } from "./products.routes";
import { categoriesRouter } from "./categories.routes";
import { pricingAdminRouter } from "./pricing.routes";

export { productService } from "./products.service";
export { productRepository } from "./products.repository";
export { productController } from "./products.controller";
export type { Product, CreateProductInput, UpdateProductInput } from "./products.types";
export { adjustPrices, rollbackBatch, applyAdjustment } from "./pricing.service";

export const definition = {
  name: "products",
  basePath: "/api/products",
  router: productsRouter,
} as const;

export const categoriesDefinition = {
  name: "categories",
  basePath: "/api/categories",
  router: categoriesRouter,
} as const;

/**
 * Privileged price-adjustment endpoints — mounted at /api/admin/pricing.
 * Kept in the products module because price is part of the product bounded
 * context. Auth/role enforcement lives inside the router itself.
 */
export const pricingAdminDefinition = {
  name: "pricing-admin",
  basePath: "/api/admin/pricing",
  router: pricingAdminRouter,
} as const;

export type ModuleDefinition = typeof definition;
