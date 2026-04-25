export interface Product {
  id: number;
  name: string;
  description: string | null;
  unit: string;
  pricePerUnit: number;
  stock: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateProductInput = Omit<Product, "id" | "createdAt" | "updatedAt" | "description"> & {
  description?: string | null;
};
export type UpdateProductInput = Partial<CreateProductInput>;
