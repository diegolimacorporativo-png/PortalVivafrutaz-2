import type {
  Product as SchemaProduct,
  Order as SchemaOrder,
  OrderItem as SchemaOrderItem,
  Company as SchemaCompany,
  FiscalInvoice as SchemaFiscalInvoice,
  ProductSubCategory,
  InsertProductSubCategory,
  InsertProduct,
  User as SchemaUser,
} from "@shared/schema";
import { storage } from "../../services/storage";
import type { Product, CreateProductInput, UpdateProductInput } from "./products.types";

export interface SystemLogEntry {
  action: string;
  description: string;
  userEmail?: string;
  level?: string;
  ip?: string;
}

export interface IProductRepository {
  findAll(): Promise<Product[]>;
  findById(id: number): Promise<Product | undefined>;
  create(input: CreateProductInput): Promise<Product>;
  update(id: number, input: UpdateProductInput): Promise<Product>;
  delete(id: number): Promise<void>;
  findAllForCodeLookup(): Promise<SchemaProduct[]>;
  findAllProducts(): Promise<SchemaProduct[]>;
  findAllOrders(): Promise<SchemaOrder[]>;
  findOrderDetail(id: number): Promise<{ order: SchemaOrder; items: SchemaOrderItem[] } | undefined>;
  findAllCompanies(): Promise<SchemaCompany[]>;
  findAllFiscalInvoices(): Promise<SchemaFiscalInvoice[]>;
  updateProductFlags(id: number, updates: Partial<InsertProduct>): Promise<SchemaProduct>;
  findUser(id: number): Promise<SchemaUser | undefined>;
  createSystemLog(entry: SystemLogEntry): Promise<void>;
  findSubCategoriesByProductId(productId: number): Promise<ProductSubCategory[]>;
  createSubCategory(data: InsertProductSubCategory): Promise<ProductSubCategory>;
  updateSubCategory(id: number, updates: Partial<InsertProductSubCategory>): Promise<ProductSubCategory>;
  deleteSubCategory(id: number): Promise<void>;
  deleteSubCategoriesByProductId(productId: number): Promise<void>;
}

export class ProductRepository implements IProductRepository {
  async findAll(): Promise<Product[]> {
    throw new Error("Not implemented — wire to DB in future migration");
  }

  async findAllForCodeLookup(): Promise<SchemaProduct[]> {
    return storage.getProducts();
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

  async findAllProducts(): Promise<SchemaProduct[]> {
    return storage.getProducts();
  }

  async findAllOrders(): Promise<SchemaOrder[]> {
    return storage.getOrders();
  }

  async findOrderDetail(id: number): Promise<{ order: SchemaOrder; items: SchemaOrderItem[] } | undefined> {
    return storage.getOrder(id);
  }

  async findAllCompanies(): Promise<SchemaCompany[]> {
    return storage.getCompanies();
  }

  async findAllFiscalInvoices(): Promise<SchemaFiscalInvoice[]> {
    return storage.getFiscalInvoices();
  }

  async updateProductFlags(id: number, updates: Partial<InsertProduct>): Promise<SchemaProduct> {
    return storage.updateProduct(id, updates);
  }

  async findUser(id: number): Promise<SchemaUser | undefined> {
    return storage.getUser(id);
  }

  async createSystemLog(entry: SystemLogEntry): Promise<void> {
    return storage.createLog(entry);
  }

  async findSubCategoriesByProductId(productId: number): Promise<ProductSubCategory[]> {
    return storage.getProductSubCategoriesByProductId(productId);
  }

  async createSubCategory(data: InsertProductSubCategory): Promise<ProductSubCategory> {
    return storage.createProductSubCategory(data);
  }

  async updateSubCategory(id: number, updates: Partial<InsertProductSubCategory>): Promise<ProductSubCategory> {
    return storage.updateProductSubCategory(id, updates);
  }

  async deleteSubCategory(id: number): Promise<void> {
    return storage.deleteProductSubCategory(id);
  }

  async deleteSubCategoriesByProductId(productId: number): Promise<void> {
    return storage.deleteProductSubCategoriesByProductId(productId);
  }
}

export const productRepository = new ProductRepository();
