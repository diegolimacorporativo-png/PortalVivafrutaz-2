import type { Product, CreateProductInput, UpdateProductInput } from "./products.types";

export interface IProductRepository {
  findAll(): Promise<Product[]>;
  findById(id: number): Promise<Product | undefined>;
  create(input: CreateProductInput): Promise<Product>;
  update(id: number, input: UpdateProductInput): Promise<Product>;
  delete(id: number): Promise<void>;
}

export class ProductRepository implements IProductRepository {
  async findAll(): Promise<Product[]> {
    throw new Error("Not implemented — wire to DB in future migration");
  }

  async findById(_id: number): Promise<Product | undefined> {
    throw new Error("Not implemented — wire to DB in future migration");
  }

  async create(_input: CreateProductInput): Promise<Product> {
    throw new Error("Not implemented — wire to DB in future migration");
  }

  async update(_id: number, _input: UpdateProductInput): Promise<Product> {
    throw new Error("Not implemented — wire to DB in future migration");
  }

  async delete(_id: number): Promise<void> {
    throw new Error("Not implemented — wire to DB in future migration");
  }
}

export const productRepository = new ProductRepository();
