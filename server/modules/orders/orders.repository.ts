import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../database/db";
import { orders, orderItems } from "@shared/schema";
import { storage } from "../../services/storage";
import {
  tenantWhere,
  tenantAnd,
  withTenant,
  withTenantAll,
  stripTenantFields,
} from "../../core/tenant/scope";
import { currentTenantId, requireTenantId } from "../../core/tenant/context";
import { getRequestIdForLog } from "../../core/context/requestContext";
import { ForbiddenError, NotFoundError } from "../../shared/errors/AppError";
import {
  executeWorkflowTransaction,
  type TransactionInput,
  type CriticalTransitionResult,
} from "./orders.transaction";
import type {
  Order,
  OrderDetail,
  OrdersListFilter,
  InsertOrder,
  InsertOrderItem,
} from "./orders.types";

/**
 * OrdersRepository — multi-tenant data access for the orders domain.
 *
 * Architecture decision: tenant scoping is enforced HERE, at the repository
 * boundary, by funneling every query through `tenantWhere(orders)` /
 * `withTenant(orders, ...)`. The service layer above never spells out an
 * `empresaId`/`companyId` filter by hand — if it did, a forgotten predicate
 * would leak rows across tenants. Centralizing the predicate makes that
 * impossible by construction.
 *
 * Field-name note: `orders.companyId` IS the tenant marker for this table —
 * each order belongs to the company that placed it, which equals the tenant.
 * The `tenantWhere(orders)` helper auto-detects this (resolution order:
 * tenantId → empresaId → companyId), so callers never reference the
 * underlying field name directly.
 *
 * Cross-tenant escape hatch: GET endpoints used by MASTER/internal admins
 * (cross-tenant operators) read with `currentTenantId()` and skip the
 * predicate when it returns `null`. Every such site is annotated below.
 * Writes never opt out — `requireTenantId()` throws 403 if no tenant is
 * pinned, even for admins.
 */
export class OrdersRepository {
  // ── Reads ───────────────────────────────────────────────────────────────

  /**
   * List orders for the current tenant. A MASTER admin without a target
   * tenant (`?empresaId=N`) sees ALL orders — that is the documented
   * cross-tenant case. Any other principal is hard-scoped.
   */
  list(filter: OrdersListFilter = {}): Promise<Order[]> {
    const tenantId = currentTenantId();
    if (tenantId == null) {
      // Cross-tenant admin path. The legacy contract preserved.
      return storage.getOrders(filter.empresaId as number | undefined);
    }
    return db
      .select()
      .from(orders)
      .where(tenantWhere(orders))
      .orderBy(desc(orders.orderDate)) as unknown as Promise<Order[]>;
  }

  /**
   * Fetch one order + its items. Tenant-verified: if the persisted
   * `companyId` doesn't match the current tenant, we 404 (NOT 403) so the
   * existence of the row is not disclosed cross-tenant.
   */
  async get(id: number): Promise<OrderDetail | undefined> {
    const tenantId = currentTenantId();
    const detail = await storage.getOrder(id);
    if (!detail) return undefined;
    if (tenantId != null && (detail.order as any).companyId !== tenantId) {
      // Tenant mismatch — pretend not found.
      return undefined;
    }
    return detail;
  }

  /**
   * Orders for an arbitrary company. Cross-tenant admins may pass any id;
   * pinned tenants are forced to their own. This is the choke point used
   * by the company-portal "my orders" page.
   */
  listByCompany(companyId: number): Promise<Order[]> {
    const tenantId = currentTenantId();
    if (tenantId != null && tenantId !== companyId) {
      // Hard-stop: pinned tenant trying to read another tenant.
      throw new ForbiddenError("Tenant não autorizado a acessar esta empresa");
    }
    return storage.getCompanyOrders(companyId);
  }

  /**
   * Same as `listByCompany` but uses the storage method that returns the
   * "non-cancelled, with delivery date" rows. Same tenant guard.
   */
  listByCompanyId(companyId: number): Promise<Order[]> {
    const tenantId = currentTenantId();
    if (tenantId != null && tenantId !== companyId) {
      throw new ForbiddenError("Tenant não autorizado a acessar esta empresa");
    }
    return storage.getOrdersByCompanyId(companyId);
  }

  // ── Writes ──────────────────────────────────────────────────────────────

  /**
   * Insert an order + its items in one logical operation. The order's
   * `companyId` is forced to the current tenant — any value the caller
   * passed is overwritten. Items get a tenant stamp on `empresaId` (their
   * own column name).
   */
  async create(order: InsertOrder, items: InsertOrderItem[]): Promise<Order> {
    // Force the tenant on both halves; never trust the request body.
    const tenantId = requireTenantId();
    const safeOrder = { ...order, companyId: tenantId } as InsertOrder;
    const safeItems = items.map((it) => ({ ...it, empresaId: tenantId }));
    return storage.createOrder(safeOrder, safeItems as any);
  }

  /**
   * Patch an existing order. We pre-flight a tenant check so an update from
   * tenant A on tenant B's order returns 404 (not 403) — same disclosure
   * posture as `get()`. We also strip any tenant field from the patch.
   */
  async update(id: number, updates: Record<string, any>): Promise<Order> {
    await this.assertOwned(id);
    const safe = stripTenantFields(updates);
    return storage.updateOrder(id, safe);
  }

  /**
   * Delete an order. Same pre-flight tenant guard as `update`.
   */
  async remove(id: number): Promise<void> {
    await this.assertOwned(id);
    return storage.deleteOrder(id);
  }

  /**
   * Replace the items of an order. Tenant-guarded.
   */
  async updateItems(
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
    await this.assertOwned(id);
    return storage.updateOrderItems(id, items);
  }

  /**
   * Verifies the order belongs to the current tenant. Throws `NotFoundError`
   * if the row doesn't exist OR belongs to another tenant — never reveal
   * existence cross-tenant.
   */
  private async assertOwned(id: number): Promise<void> {
    const tenantId = currentTenantId();
    if (tenantId == null) return; // cross-tenant admin
    const [row] = await db
      .select({ companyId: orders.companyId })
      .from(orders)
      .where(eq(orders.id, id));
    if (!row || row.companyId !== tenantId) {
      console.warn(
        `[SECURITY] WRITE_BLOCKED | requestId=${getRequestIdForLog()} | orderId=${id} | details=write blocked tenant=${tenantId} orderCompanyId=${row?.companyId ?? "not_found"}`,
      );
      throw new NotFoundError("Pedido não encontrado");
    }
  }

  // ── Cross-resource lookups (kept thin — service composes them) ──────────
  // These do NOT take an empresaId because the underlying storage methods
  // either return globally-scoped rows (settings, products) or are themselves
  // refactor candidates (companies, users) handled by other modules.

  getCompany(id: number) {
    return storage.getCompany(id);
  }

  getProducts() {
    return storage.getProducts();
  }

  getProductById(id: number) {
    return storage.getProductById(id);
  }

  /**
   * STEP 4 — pricing por categoria. Single-row lookup of a product
   * sub-category by id. Used by the pricing flow to resolve
   * `subCategoryPrice` when an order item carries `subCategoryId`.
   * Returns null when the row does not exist (never throws).
   */
  getProductSubCategoryById(id: number) {
    return storage.getProductSubCategoryById(id);
  }

  /**
   * STEP 5 — pricing por cliente (contract). Single-row lookup of a
   * `contractScopes` row for the (companyId, productId) pair. Used by
   * the pricing flow to resolve `contractPrice` (highest priority in
   * the resolver). Returns null when no scope row exists for that
   * customer/product (never throws).
   */
  getContractScope(companyId: number, productId: number) {
    return storage.getContractScope(companyId, productId);
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

  // ── Side-effect persistence (logs, deliveries, danfe, AR, stock) ────────
  // These ride on tables that already carry their own tenant column or are
  // append-only audit logs. The service layer is responsible for passing
  // the correct companyId/empresaId; tenancy is double-checked here when
  // possible.

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

  getLogsByOrderCode(orderCode: string) {
    return storage.getLogsByOrderCode(orderCode);
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

  updateDelivery(id: number, data: Record<string, any>) {
    return storage.updateDelivery(id, data as any);
  }

  getAccountsReceivableByCompanyId(companyId: number) {
    return storage.getAccountsReceivable({ companyId });
  }

  /** All companies — used by the export report. */
  getCompanies() {
    return storage.getCompanies();
  }

  /**
   * Execute all critical DB writes for a workflow transition atomically.
   *
   * Architecture decision: the transaction function uses raw Drizzle ORM and
   * is therefore a DB-layer concern. Keeping its call site here (repository)
   * means the service never touches ORM code directly — it only composes
   * high-level repo methods. `orders.transaction.ts` acts as a private
   * implementation detail of this repository.
   */
  executeTransition(input: TransactionInput): Promise<CriticalTransitionResult> {
    return executeWorkflowTransaction(input);
  }
}

export const ordersRepository = new OrdersRepository();
