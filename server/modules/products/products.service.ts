import { productRepository, type IProductRepository } from "./products.repository";
import type { Product, CreateProductInput, UpdateProductInput } from "./products.types";

export class ProductService {
  constructor(private readonly repo: IProductRepository = productRepository) {}

  async listProducts(): Promise<Product[]> {
    return this.repo.findAll();
  }

  async getProduct(id: number): Promise<Product> {
    const product = await this.repo.findById(id);
    if (!product) throw Object.assign(new Error("Produto não encontrado."), { status: 404 });
    return product;
  }

  async createProduct(input: CreateProductInput): Promise<Product> {
    return this.repo.create(input);
  }

  async updateProduct(id: number, input: UpdateProductInput): Promise<Product> {
    await this.getProduct(id);
    return this.repo.update(id, input);
  }

  async deleteProduct(id: number): Promise<void> {
    await this.getProduct(id);
    return this.repo.delete(id);
  }
}

export const productService = new ProductService();
