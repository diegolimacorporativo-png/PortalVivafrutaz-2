import { storage } from "../../services/storage";
import type {
  Order,
  OrderDetail,
  OrdersListFilter,
  InsertOrder,
  InsertOrderItem,
} from "./orders.types";

/**
 * OrdersRepository — the only place the orders module talks to persistence.
 *
 * Architecture decision: every method delegates to the legacy `storage`
 * facade because it already implements the Drizzle queries used across the
 * codebase. When `storage` is split by domain in a later pass, the body of
 * each method can be swapped for direct Drizzle calls (e.g.
 * `db.select().from(orders)`) without touching the service or controller.
 *
 * Repository = data access only. No business rules, no HTTP, no logging.
 * Side-effects (push notifications, emails, account-receivable seeding,
 * inventory deduction, auto-logistics) live in the service layer because
 * they orchestrate multiple resources and are not pure persistence.
 */
export class OrdersRepository {
  // ── Reads ───────────────────────────────────────────────────────────
  list(filter: OrdersListFilter = {}): Promise<Order[]> {
    return storage.getOrders(filter.empresaId as number | undefined);
  }

  get(id: number): Promise<OrderDetail | undefined> {
    return storage.getOrder(id);
  }

  listByCompany(companyId: number): Promise<Order[]> {
    return storage.getCompanyOrders(companyId);
  }

  /**
   * Return a denormalized list of orders for the same company. Used by the
   * date-lock check in `service.create()` (the legacy code calls this same
   * storage method — we surface it here so the service stays storage-free).
   */
  listByCompanyId(companyId: number): Promise<Order[]> {
    return storage.getOrdersByCompanyId(companyId);
  }

  // ── Writes ──────────────────────────────────────────────────────────
  create(order: InsertOrder, items: InsertOrderItem[]): Promise<Order> {
    return storage.createOrder(order, items);
  }

  update(id: number, updates: Record<string, any>): Promise<Order> {
    return storage.updateOrder(id, updates);
  }

  remove(id: number): Promise<void> {
    return storage.deleteOrder(id);
  }

  updateItems(
    id: number,
    items: {
      productId: number;
      quantity: number;
      unitPrice: string;
      totalPrice: string;
      subCategoryId?: number | null;
      subCategoryName?: string | null;
    }[],
  ): Promise<void> {
    return storage.updateOrderItems(id, items);
  }

  // ── Cross-resource lookups (kept thin — service composes them) ──────
  getCompany(id: number) {
    return storage.getCompany(id);
  }

  getProducts() {
    return storage.getProducts();
  }

  getCompanyConfig() {
    return storage.getCompanyConfig();
  }

  getUser(id: number) {
    return storage.getUser(id);
  }

  getUsers() {
    return storage.getUsers();
  }

  getSetting(key: string) {
    return storage.getSetting(key);
  }

  // ── Side-effect persistence (logs, deliveries, danfe, AR, stock) ────
  createLog(log: {
    action: string;
    description: string;
    userId?: number;
    companyId?: number;
    userEmail?: string;
    userRole?: string;
    ip?: string;
    level?: string;
  }) {
    return storage.createLog(log);
  }

  getDeliveryByOrder(orderId: number) {
    return storage.getDeliveryByOrder(orderId);
  }

  createDelivery(data: any) {
    return storage.createDelivery(data);
  }

  createTestOrder(data: {
    orderCode: string;
    companyId: number;
    companyName: string;
    deliveryDate: Date;
    weekReference: string;
    totalValue: string;
    orderNote?: string | null;
    items: any[];
    createdBy?: number;
  }) {
    return storage.createTestOrder(data);
  }

  getDanfeRecordsByOrderId(orderId: number) {
    return storage.getDanfeRecordsByOrderId(orderId);
  }

  createDanfeRecord(record: {
    orderId: number;
    orderCode: string | null;
    generatedByUserId: number;
    generatedByEmail: string;
  }) {
    return storage.createDanfeRecord(record);
  }

  getAccountReceivableByOrderId(orderId: number) {
    return storage.getAccountReceivableByOrderId(orderId);
  }

  createAccountReceivable(data: any) {
    return storage.createAccountReceivable(data);
  }

  getInventorySettingByProductId(productId: number) {
    return storage.getInventorySettingByProductId(productId);
  }

  getInventorySettingByProductName(name: string) {
    return storage.getInventorySettingByProductName(name);
  }

  upsertInventorySetting(data: any) {
    return storage.upsertInventorySetting(data);
  }

  createInventoryMovement(data: any) {
    return storage.createInventoryMovement(data);
  }
}

export const ordersRepository = new OrdersRepository();
