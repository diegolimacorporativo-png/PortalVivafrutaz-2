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
  Category,
  InsertCategory,
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
  findOrderItemByProduct(orderId: number, productId: number): Promise<SchemaOrderItem | undefined>;
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
  findAllCategories(): Promise<Category[]>;
  createCategory(data: InsertCategory): Promise<Category>;
  updateCategory(id: number, updates: Partial<InsertCategory>): Promise<Category>;
  deleteCategory(id: number): Promise<void>;
}

export class ProductRepository implements IProductRepository {
  async findAll(): Promise<Product[]> {
    return storage.getProducts();
  }

  async findAllForCodeLookup(): Promise<SchemaProduct[]> {
    return storage.getProducts();
  }

  async findById(id: number): Promise<Product | undefined> {
    return storage.getProductById(id);
  }

  async create(input: CreateProductInput): Promise<Product> {
    return storage.createProduct(input);
  }

  async update(id: number, input: UpdateProductInput): Promise<Product> {
    return storage.updateProduct(id, input);
  }

  async delete(id: number): Promise<void> {
    return storage.deleteProduct(id);
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

  async findOrderItemByProduct(orderId: number, productId: number): Promise<SchemaOrderItem | undefined> {
    return storage.getOrderItemByProduct(orderId, productId);
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

  async findAllCategories(): Promise<Category[]> {
    return storage.getCategories();
  }

  async createCategory(data: InsertCategory): Promise<Category> {
    return storage.createCategory(data);
  }

  async updateCategory(id: number, updates: Partial<InsertCategory>): Promise<Category> {
    return storage.updateCategory(id, updates);
  }

  async deleteCategory(id: number): Promise<void> {
    return storage.deleteCategory(id);
  }
}

export const productRepository = new ProductRepository();
