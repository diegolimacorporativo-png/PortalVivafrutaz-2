import { productRepository, type IProductRepository, type SystemLogEntry } from "./products.repository";
import type { Product, CreateProductInput, UpdateProductInput } from "./products.types";
import type {
  Product as SchemaProduct,
  ProductSubCategory,
  InsertProductSubCategory,
  User as SchemaUser,
} from "@shared/schema";

export interface SafraAlertOrder {
  orderId: number;
  orderCode: string | null;
  companyId: number;
  companyName: string;
  deliveryDate: Date | string;
  itemId: number;
  quantity: number | string;
  unitPrice: number | string;
  totalPrice: number | string;
}

export interface SafraAlert {
  product: SchemaProduct;
  affectedOrders: SafraAlertOrder[];
}

export interface CodeCheckResult {
  exists: boolean;
  product: { id: number; name: string } | null;
}

export interface PriceAlertInvoiceItem {
  unitPrice: number;
  invoiceDate: string | Date;
  invoiceNumber: string;
  supplier: string;
}

export interface PriceAlert {
  product: {
    id: number;
    name: string;
    category: string | null;
    productCode: string | null;
    basePrice: number;
  };
  latestCost: number;
  variation: number;
  direction: "increase" | "decrease";
  latestInvoice: PriceAlertInvoiceItem;
  derivedProducts: { id: number; name: string; category: string | null }[];
}

const ALERT_THRESHOLD = 0.20;

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

  async getNextProductCode(): Promise<string> {
    const all = await this.repo.findAllForCodeLookup();
    const usedCodes = all
      .map((p) => p.productCode)
      .filter((c): c is string => Boolean(c))
      .map((c) => parseInt(c.replace(/\D/g, ''), 10))
      .filter((n) => !isNaN(n));
    const maxCode = usedCodes.length > 0 ? Math.max(...usedCodes) : 0;
    return String(maxCode + 1).padStart(3, '0');
  }

  async getSafraAlerts(): Promise<SafraAlert[]> {
    const [allProducts, allOrders, allCompanies] = await Promise.all([
      this.repo.findAllProducts(),
      this.repo.findAllOrders(),
      this.repo.findAllCompanies(),
    ]);

    const outOfSeasonProducts = allProducts.filter((p) => p.outOfSeason);
    if (outOfSeasonProducts.length === 0) return [];

    const activeOrders = allOrders.filter((o) => o.status !== 'CANCELLED');

    const alerts = await Promise.all(outOfSeasonProducts.map(async (product) => {
      const affectedOrders: SafraAlertOrder[] = [];
      for (const order of activeOrders) {
        try {
          const detail = await this.repo.findOrderDetail(order.id);
          const matchingItem = (detail?.items || []).find((item) => item.productId === product.id);
          if (matchingItem) {
            const company = allCompanies.find((c) => c.id === order.companyId);
            affectedOrders.push({
              orderId: order.id,
              orderCode: order.orderCode,
              companyId: order.companyId,
              companyName: company?.companyName || `Empresa #${order.companyId}`,
              deliveryDate: order.deliveryDate,
              itemId: matchingItem.id,
              quantity: matchingItem.quantity,
              unitPrice: matchingItem.unitPrice,
              totalPrice: matchingItem.totalPrice,
            });
          }
        } catch { /* ignore */ }
      }
      return { product, affectedOrders };
    }));

    return alerts.filter((a) => a.affectedOrders.length > 0);
  }

  async checkProductCode(code: string, excludeId: number | null): Promise<CodeCheckResult> {
    if (!code) return { exists: false, product: null };
    const all = await this.repo.findAllProducts();
    const match = all.find(
      (p) => p.productCode != null && p.productCode.trim() === code && (!excludeId || p.id !== excludeId)
    );
    return { exists: !!match, product: match ? { id: match.id, name: match.name } : null };
  }

  async checkProductDuplicate(name: string, code: string, excludeId: number | null): Promise<CodeCheckResult> {
    if (!name) return { exists: false, product: null };
    const all = await this.repo.findAllProducts();
    const match = all.find((p) => {
      const sameName = p.name.trim().toLowerCase() === name;
      const sameCode = code ? (p.productCode || '').trim() === code : false;
      const notSelf = !excludeId || p.id !== excludeId;
      return notSelf && sameName && (sameCode || !code);
    });
    return { exists: !!match, product: match ? { id: match.id, name: match.name } : null };
  }

  async getPriceAlerts(): Promise<PriceAlert[]> {
    const [allProducts, allInvoices] = await Promise.all([
      this.repo.findAllProducts(),
      this.repo.findAllFiscalInvoices(),
    ]);

    const alerts: PriceAlert[] = [];

    for (const product of allProducts) {
      if (!product.basePrice || Number(product.basePrice) <= 0) continue;
      const basePrice = Number(product.basePrice);

      const linkedItems: PriceAlertInvoiceItem[] = [];
      for (const invoice of allInvoices) {
        const items = ((invoice as { items?: unknown }).items as Array<{ linkedProductId?: number | null; unitPrice?: number | string | null }> | undefined) || [];
        for (const item of items) {
          if (item.linkedProductId === product.id && item.unitPrice) {
            linkedItems.push({
              unitPrice: Number(item.unitPrice),
              invoiceDate: invoice.issueDate || invoice.importedAt,
              invoiceNumber: invoice.invoiceNumber,
              supplier: invoice.supplier,
            });
          }
        }
      }

      if (linkedItems.length === 0) continue;

      const latestCost = linkedItems[0]!.unitPrice;
      const variation = (latestCost - basePrice) / basePrice;

      if (Math.abs(variation) >= ALERT_THRESHOLD) {
        const derivedProducts = product.productCode
          ? allProducts.filter(
              (p) => p.productCode === product.productCode && p.id !== product.id
            )
          : [];

        alerts.push({
          product: {
            id: product.id,
            name: product.name,
            category: product.category,
            productCode: product.productCode,
            basePrice,
          },
          latestCost,
          variation: +(variation * 100).toFixed(1),
          direction: variation > 0 ? 'increase' : 'decrease',
          latestInvoice: linkedItems[0]!,
          derivedProducts: derivedProducts.map((p) => ({ id: p.id, name: p.name, category: p.category })),
        });
      }
    }

    return alerts;
  }

  async toggleOutOfSeason(
    id: number,
    outOfSeason: boolean,
    actingUserId: number | null,
    ip: string,
  ): Promise<SchemaProduct> {
    const product = await this.repo.updateProductFlags(id, { outOfSeason });
    const actingUser = actingUserId ? await this.repo.findUser(actingUserId) : null;
    const entry: SystemLogEntry = {
      action: outOfSeason ? 'PRODUCT_OUT_OF_SEASON' : 'PRODUCT_IN_SEASON',
      description: `Produto #${id} marcado como ${outOfSeason ? 'FORA DE SAFRA' : 'EM SAFRA'} por ${actingUser?.name || 'Sistema'}`,
      userEmail: actingUser?.email || 'sistema',
      level: 'INFO',
      ip,
    };
    await this.repo.createSystemLog(entry);
    return product;
  }

  async listSubCategoriesForProduct(productId: number): Promise<ProductSubCategory[]> {
    return this.repo.findSubCategoriesByProductId(productId);
  }

  async addSubCategory(
    productId: number,
    input: { categoryName: string; price: string | number; active?: boolean },
  ): Promise<ProductSubCategory> {
    const data: InsertProductSubCategory = {
      productId,
      categoryName: input.categoryName,
      price: String(input.price),
      active: input.active !== false,
    };
    return this.repo.createSubCategory(data);
  }

  async editSubCategory(
    id: number,
    input: { categoryName?: string; price?: string | number; active?: boolean },
  ): Promise<ProductSubCategory> {
    const updates: Partial<InsertProductSubCategory> = {};
    if (input.categoryName !== undefined) updates.categoryName = input.categoryName;
    if (input.price !== undefined) updates.price = String(input.price);
    if (input.active !== undefined) updates.active = input.active;
    return this.repo.updateSubCategory(id, updates);
  }

  async removeSubCategory(id: number): Promise<void> {
    return this.repo.deleteSubCategory(id);
  }

  async removeAllSubCategoriesForProduct(productId: number): Promise<void> {
    return this.repo.deleteSubCategoriesByProductId(productId);
  }

  async getActor(userId: number): Promise<SchemaUser | undefined> {
    return this.repo.findUser(userId);
  }
}

export const productService = new ProductService();
