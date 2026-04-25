import type { Product, InsertProduct } from "@shared/schema";

export type { Product, InsertProduct };
export type CreateProductInput = InsertProduct;
export type UpdateProductInput = Partial<InsertProduct>;
