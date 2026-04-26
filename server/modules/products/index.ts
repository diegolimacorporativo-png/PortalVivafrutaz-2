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

export { productService } from "./products.service";
export { productRepository } from "./products.repository";
export { productController } from "./products.controller";
export type { Product, CreateProductInput, UpdateProductInput } from "./products.types";

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

export type ModuleDefinition = typeof definition;
