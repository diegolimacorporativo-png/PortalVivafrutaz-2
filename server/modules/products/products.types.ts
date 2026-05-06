import type { Product, InsertProduct } from "@shared/schema";

export type { Product, InsertProduct };
export type CreateProductInput = InsertProduct;
export type UpdateProductInput = Partial<InsertProduct>;

/**
 * Product as returned by the API — basePrice is always a number
 * (null when not set for category-priced products).
 * Transitional type: use while migrating from string → number.
 */
export type NormalizedProduct = Omit<Product, "basePrice"> & {
  basePrice: number | null;
};
