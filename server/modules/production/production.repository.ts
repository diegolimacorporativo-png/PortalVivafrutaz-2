import { and, desc, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { db } from "../../database/db";
import {
  productionBatches,
  productionBatchItems,
  orders,
  orderItems,
  products,
  companies,
  logisticsRoutes,
} from "@shared/schema";
import { NotFoundError } from "../../shared/errors/AppError";
import type {
  ProductionBatch,
  ProductionBatchItem,
} from "@shared/schema";

// ─── Types ─────────────────────────────────────────────────────

export interface OrderBreakdownEntry {
  orderId: number;
  orderCode: string;
  companyId: number;
  companyName: string;
  quantity: number;
}

export interface RouteBreakdownEntry {
  routeId: number | null;
  routeName: string;
  quantity: number;
  companies: Array<{ companyId: number; companyName: string; quantity: number }>;
}

export interface BatchWithItems extends ProductionBatch {
  items: Array<
    ProductionBatchItem & {
      orderBreakdown: OrderBreakdownEntry[];
      routeBreakdown: RouteBreakdownEntry[];
    }
  >;
}

export interface RawOrderItemRow {
  orderId: number;
  orderCode: string | null;
  companyId: number;
  companyName: string;
  deliveryDate: Date | string;
  productId: number;
  productName: string;
  category: string | null;
  unit: string | null;
  quantity: number;
}

// ─── Repository ────────────────────────────────────────────────

export const productionRepository = {
  /**
   * Fetch all orders items for a given delivery date and status filter.
   * Used by the service to build a production batch.
   */
  async getRawOrderItemsForDate(
    empresaId: number | null,
    productionDate: string,
    includeStatuses: string[],
  ): Promise<RawOrderItemRow[]> {
    const rows = await db
      .select({
        orderId: orders.id,
        orderCode: orders.orderCode,
        companyId: orders.companyId,
        companyName: companies.companyName,
        deliveryDate: orders.deliveryDate,
        productId: orderItems.productId,
        productName: products.name,
        category: products.category,
        unit: products.unit,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .innerJoin(companies, eq(orders.companyId, companies.id))
      .where(
        and(
          // Delivery date matches production date
          sql`DATE(${orders.deliveryDate}) = ${productionDate}`,
          // Status filter
          inArray(orders.workflowStatus, includeStatuses),
          // Tenant scope (null = cross-tenant MASTER)
          empresaId != null ? eq(orders.companyId, empresaId) : undefined,
        ),
      );

    return rows.map((r) => ({
      ...r,
      quantity: Number(r.quantity),
    }));
  },

  /**
   * Fetch logistics routes for a given delivery date to build route breakdown.
   */
  async getRoutesForDate(
    empresaId: number | null,
    productionDate: string,
  ): Promise<Array<{ id: number; name: string; companyIds: number[] }>> {
    const rows = await db
      .select({
        id: logisticsRoutes.id,
        name: logisticsRoutes.name,
        companyIds: logisticsRoutes.companyIds,
      })
      .from(logisticsRoutes)
      .where(
        and(
          eq(logisticsRoutes.deliveryDate, productionDate),
          empresaId != null ? eq(logisticsRoutes.empresaId, empresaId) : undefined,
        ),
      );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      companyIds: Array.isArray(r.companyIds) ? (r.companyIds as number[]) : [],
    }));
  },

  /** Find an existing batch for a date + empresaId. */
  async findByDateAndEmpresa(
    empresaId: number | null,
    productionDate: string,
  ): Promise<ProductionBatch | null> {
    const rows = await db
      .select()
      .from(productionBatches)
      .where(
        and(
          eq(productionBatches.productionDate, productionDate),
          empresaId != null
            ? eq(productionBatches.empresaId, empresaId)
            : sql`${productionBatches.empresaId} IS NULL`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  /** List batches with pagination. */
  async list(
    empresaId: number | null,
    opts: { status?: string; date?: string; page: number; limit: number },
  ) {
    const conditions = [
      empresaId != null
        ? eq(productionBatches.empresaId, empresaId)
        : undefined,
      opts.status ? eq(productionBatches.status, opts.status) : undefined,
      opts.date ? eq(productionBatches.productionDate, opts.date) : undefined,
    ].filter(Boolean) as ReturnType<typeof eq>[];

    const rows = await db
      .select()
      .from(productionBatches)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(productionBatches.productionDate))
      .limit(opts.limit)
      .offset((opts.page - 1) * opts.limit);

    return rows;
  },

  /** Get a single batch with its items. */
  async getById(id: number): Promise<BatchWithItems> {
    const [batch] = await db
      .select()
      .from(productionBatches)
      .where(eq(productionBatches.id, id))
      .limit(1);
    if (!batch) throw new NotFoundError("Lote de produção não encontrado");

    const items = await db
      .select()
      .from(productionBatchItems)
      .where(eq(productionBatchItems.batchId, id))
      .orderBy(productionBatchItems.productName);

    return {
      ...batch,
      items: items.map((item) => ({
        ...item,
        totalQuantity: String(item.totalQuantity),
        checkedQuantity: String(item.checkedQuantity ?? "0"),
        orderBreakdown: (item.orderBreakdown as OrderBreakdownEntry[]) ?? [],
        routeBreakdown: (item.routeBreakdown as RouteBreakdownEntry[]) ?? [],
      })),
    };
  },

  /** Create a batch and its items inside a transaction. */
  async createBatch(
    batchData: {
      empresaId: number | null;
      productionDate: string;
      status: string;
      notes?: string;
      generatedAt: Date;
    },
    itemsData: Array<{
      productId: number;
      productName: string;
      category: string | null;
      unit: string;
      totalQuantity: number;
      orderBreakdown: OrderBreakdownEntry[];
      routeBreakdown: RouteBreakdownEntry[];
    }>,
  ): Promise<BatchWithItems> {
    return db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(productionBatches)
        .values({
          empresaId: batchData.empresaId,
          productionDate: batchData.productionDate,
          status: batchData.status,
          notes: batchData.notes,
          generatedAt: batchData.generatedAt,
        })
        .returning();

      if (itemsData.length > 0) {
        await tx.insert(productionBatchItems).values(
          itemsData.map((item) => ({
            batchId: batch.id,
            productId: item.productId,
            productName: item.productName,
            category: item.category,
            unit: item.unit,
            totalQuantity: String(item.totalQuantity),
            checkedQuantity: "0",
            orderBreakdown: item.orderBreakdown,
            routeBreakdown: item.routeBreakdown,
          })),
        );
      }

      const items = await tx
        .select()
        .from(productionBatchItems)
        .where(eq(productionBatchItems.batchId, batch.id))
        .orderBy(productionBatchItems.productName);

      return {
        ...batch,
        items: items.map((item) => ({
          ...item,
          totalQuantity: String(item.totalQuantity),
          checkedQuantity: String(item.checkedQuantity ?? "0"),
          orderBreakdown: (item.orderBreakdown as OrderBreakdownEntry[]) ?? [],
          routeBreakdown: (item.routeBreakdown as RouteBreakdownEntry[]) ?? [],
        })),
      };
    });
  },

  /** Update batch status (and optionally notes). */
  async updateStatus(
    id: number,
    status: string,
    notes?: string,
  ): Promise<ProductionBatch> {
    const [updated] = await db
      .update(productionBatches)
      .set({
        status,
        ...(notes !== undefined ? { notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(productionBatches.id, id))
      .returning();
    if (!updated) throw new NotFoundError("Lote de produção não encontrado");
    return updated;
  },

  /** Update item checked quantity. */
  async updateItemCheck(
    itemId: number,
    checkedQuantity: number,
    notes?: string,
  ): Promise<ProductionBatchItem> {
    const [updated] = await db
      .update(productionBatchItems)
      .set({
        checkedQuantity: String(checkedQuantity),
        ...(notes !== undefined ? { notes } : {}),
      })
      .where(eq(productionBatchItems.id, itemId))
      .returning();
    if (!updated) throw new NotFoundError("Item não encontrado");
    return updated;
  },

  /** Delete a batch (cascades to items). */
  async deleteBatch(id: number): Promise<void> {
    await db
      .delete(productionBatches)
      .where(eq(productionBatches.id, id));
  },
};
