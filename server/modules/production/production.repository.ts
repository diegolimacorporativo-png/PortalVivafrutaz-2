import { and, desc, eq, exists, inArray, isNull, lte, gte, or, sql } from "drizzle-orm";
import { db } from "../../database/db";
import {
  productionBatches,
  productionBatchItems,
  orders,
  orderItems,
  products,
  companies,
  logisticsRoutes,
  recurringOrderLogs,
  recurringOrderLogItems,
  contractScopes,
  contratosClientes,
  specialOrderRequests,
  companyAddresses,
} from "@shared/schema";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../../shared/errors/AppError";
import { getTenantContext } from "../../core/tenant/context";
import { GLOBAL_SCOPE_ROLES } from "@shared/user-roles";
import type {
  ProductionBatch,
  ProductionBatchItem,
} from "@shared/schema";
import { isProductionOrderEligible } from "./production-eligibility";
import type { ProductionConsolidationSource, MissingContractOccurrence } from "./production-consolidation";
import { assertProductionGlobalAccess } from "./production-authorization";

// ─── Types ─────────────────────────────────────────────────────

export interface OrderBreakdownEntry {
  itemId?: number;
  orderId: number;
  orderCode: string;
  companyId: number;
  companyName: string;
  quantity: number;
  deliveryDate?: string;
  origin?: "FREE" | "CONTRACT_FIXED" | "SPECIAL";
  routeId?: number | null;
  routeName?: string;
  subCategoryId?: number | null;
  subCategoryName?: string | null;
  deliveryAddressId?: number | null;
  deliveryAddress?: ProductionConsolidationSource["deliveryAddress"];
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
  itemId: number;
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
  productionClassification?: "IN_NATURA" | "PROCESSADOS" | null;
  workflowStatus?: string;
  productionOrigin?: string | null;
  specialRequestApprovedAndMaterialized?: boolean;
  contractOccurrenceValid?: boolean;
}

function productionCalendar(dateValue: string) {
  const date = new Date(`${dateValue}T12:00:00Z`);
  const weekday = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"][date.getUTCDay()];
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const isoWeek = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { weekday, isoWeek, weekKey: `${thursday.getUTCFullYear()}-W${String(isoWeek).padStart(2, "0")}` };
}

function contractualOccurrenceForItem(productionDate: string, executor: any = db) {
  const date = new Date(`${productionDate}T12:00:00Z`);
  const weekday = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"][date.getUTCDay()];
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const isoWeek = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const weekKey = `${thursday.getUTCFullYear()}-W${String(isoWeek).padStart(2, "0")}`;
  return exists(
    executor.select({ id: recurringOrderLogItems.id })
      .from(recurringOrderLogItems)
      .innerJoin(recurringOrderLogs, eq(recurringOrderLogs.id, recurringOrderLogItems.recurringOrderLogId))
      .innerJoin(contractScopes, eq(contractScopes.id, recurringOrderLogItems.contractScopeId))
      .innerJoin(contratosClientes, eq(contratosClientes.id, recurringOrderLogs.contractId!))
      .where(and(
        eq(recurringOrderLogs.orderId, orders.id),
        eq(recurringOrderLogs.deliveryDate, productionDate),
        eq(recurringOrderLogs.weekKey, weekKey),
        eq(recurringOrderLogs.companyId, orders.companyId),
        eq(recurringOrderLogs.contractId, contratosClientes.id),
        eq(contratosClientes.empresaId, orders.companyId),
        eq(contratosClientes.status, "ativo"),
        lte(contratosClientes.dataInicio, new Date(`${productionDate}T00:00:00Z`)),
        or(isNull(contratosClientes.dataFim), gte(contratosClientes.dataFim, new Date(`${productionDate}T23:59:59Z`))),
        eq(contractScopes.companyId, orders.companyId),
        eq(contractScopes.productId, orderItems.productId),
        eq(contractScopes.dayOfWeek, weekday),
        or(isNull(contractScopes.weekNumber), eq(contractScopes.weekNumber, isoWeek % 2 === 1 ? 1 : 2)),
        eq(recurringOrderLogItems.orderItemId, orderItems.id),
        eq(recurringOrderLogItems.quantity, orderItems.quantity),
      )),
  );
}

// ─── Repository ────────────────────────────────────────────────

/**
 * A null tenant is valid only for an authenticated, server-resolved global
 * administrator read. Production mutations always require one explicit
 * company so a missing selector cannot turn a write into a cross-company one.
 */
export function assertProductionTenantScope(
  empresaId: number | null,
  operation: "read" | "write" = "read",
): void {
  const context = getTenantContext();
  if (!context) throw new UnauthorizedError("Contexto de empresa ausente");
  if (context.empresaId !== empresaId) {
    throw new ForbiddenError("A empresa solicitada não corresponde ao contexto autorizado");
  }
  if (empresaId !== null) return;

  const principal = context.principal;
  const globalAdmin = principal.kind === "admin" &&
    (GLOBAL_SCOPE_ROLES as readonly string[]).includes(principal.role ?? "");
  if (!globalAdmin || operation === "write") {
    throw new ForbiddenError("Selecione uma empresa autorizada para esta operação");
  }
}

export const productionRepository = {
  withGlobalTransaction<T>(
    work: (tx: any) => Promise<T>,
    isolationLevel: "repeatable read" | "serializable" = "repeatable read",
  ): Promise<T> {
    assertProductionGlobalAccess();
    return db.transaction(work, { isolationLevel });
  },

  async getGlobalSourceRowsForDate(
    productionDate: string,
    executor: any = db,
  ): Promise<ProductionConsolidationSource[]> {
    assertProductionGlobalAccess();
    const rows = await executor
      .select({
        itemId: orderItems.id,
        orderId: orders.id,
        orderCode: orders.orderCode,
        companyId: orders.companyId,
        companyName: companies.companyName,
        deliveryDate: orders.deliveryDate,
        deliveryAddressId: orders.deliveryAddressId,
        deliveryAddress: {
          id: companyAddresses.id,
          companyId: companyAddresses.companyId,
          label: companyAddresses.label,
          logradouro: companyAddresses.logradouro,
          numero: companyAddresses.numero,
          complemento: companyAddresses.complemento,
          bairro: companyAddresses.bairro,
          cidade: companyAddresses.cidade,
          estado: companyAddresses.estado,
          cep: companyAddresses.cep,
        },
        productId: orderItems.productId,
        productName: products.name,
        category: products.category,
        unit: products.unit,
        productionClassification: products.productionClassification,
        sourceDescriptionSnapshot: orderItems.sourceDescriptionSnapshot,
        subCategoryId: orderItems.subCategoryId,
        subCategoryName: orderItems.subCategoryName,
        quantity: orderItems.quantity,
        workflowStatus: orders.workflowStatus,
        productionOrigin: orders.productionOrigin,
        specialRequestApprovedAndMaterialized: exists(
          executor.select({ id: specialOrderRequests.id }).from(specialOrderRequests)
            .where(and(
              eq(specialOrderRequests.generatedOrderId, orders.id),
              eq(specialOrderRequests.companyId, orders.companyId),
              eq(specialOrderRequests.status, "APPROVED"),
            )),
        ),
        contractOccurrenceValid: contractualOccurrenceForItem(productionDate, executor),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(products, eq(orderItems.productId, products.id))
      .innerJoin(companies, eq(orders.companyId, companies.id))
      .leftJoin(companyAddresses, and(
        eq(companyAddresses.id, orders.deliveryAddressId),
        eq(companyAddresses.companyId, orders.companyId),
      ))
      .where(sql`DATE(${orders.deliveryDate}) = ${productionDate}`);

    return rows.map((row: any) => ({
      ...row,
      quantity: Number(row.quantity),
      productionClassification:
        row.productionClassification === "IN_NATURA" || row.productionClassification === "PROCESSADOS"
          ? row.productionClassification
          : null,
      productionOrigin: row.productionOrigin as ProductionConsolidationSource["productionOrigin"],
      deliveryAddress: row.deliveryAddress?.id ? row.deliveryAddress : null,
      specialRequestApprovedAndMaterialized: row.specialRequestApprovedAndMaterialized === true,
      contractOccurrenceValid: row.contractOccurrenceValid === true,
    }));
  },

  async getMissingContractOccurrencesForDate(
    productionDate: string,
    executor: any = db,
  ): Promise<MissingContractOccurrence[]> {
    assertProductionGlobalAccess();
    const calendar = productionCalendar(productionDate);
    const candidates = await executor.select({
      scopeId: contractScopes.id,
      companyId: companies.id,
      companyName: companies.companyName,
      contractId: contratosClientes.id,
      contractStart: contratosClientes.dataInicio,
      contractEnd: contratosClientes.dataFim,
      productId: contractScopes.productId,
      productName: products.name,
      quantity: contractScopes.quantity,
    }).from(contractScopes)
      .innerJoin(companies, eq(companies.id, contractScopes.companyId))
      .innerJoin(contratosClientes, eq(contratosClientes.empresaId, companies.id))
      .leftJoin(products, eq(products.id, contractScopes.productId))
      .where(and(
        eq(companies.active, true),
        eq(contratosClientes.status, "ativo"),
        eq(contractScopes.dayOfWeek, calendar.weekday),
        or(isNull(contractScopes.weekNumber), eq(contractScopes.weekNumber, calendar.isoWeek % 2 === 1 ? 1 : 2)),
      ));

    const validCandidates = candidates.filter((row: any) => {
      const start = new Date(row.contractStart);
      const end = row.contractEnd ? new Date(row.contractEnd) : null;
      const deliveryStart = new Date(`${productionDate}T00:00:00`);
      const deliveryEnd = new Date(`${productionDate}T23:59:59`);
      return start <= deliveryEnd && (!end || end >= deliveryStart);
    });
    if (!validCandidates.length) return [];

    const companyContracts = new Map<number, Set<number>>();
    for (const row of validCandidates as any[]) {
      const ids = companyContracts.get(row.companyId) ?? new Set<number>();
      ids.add(row.contractId);
      companyContracts.set(row.companyId, ids);
    }

    const occurrenceRows = await executor.select({
      id: recurringOrderLogs.id,
      companyId: recurringOrderLogs.companyId,
      contractId: recurringOrderLogs.contractId,
      orderId: recurringOrderLogs.orderId,
      deliveryDate: recurringOrderLogs.deliveryDate,
    }).from(recurringOrderLogs).where(and(
      eq(recurringOrderLogs.weekKey, calendar.weekKey),
      eq(recurringOrderLogs.dayOfWeek, calendar.weekday),
    ));
    const matchingLogs = occurrenceRows.filter((log: any) => String(log.deliveryDate ?? "").slice(0, 10) === productionDate);
    const logIds = matchingLogs.map((log: any) => log.id);
    const mappings = logIds.length
      ? await executor.select({
          logId: recurringOrderLogItems.recurringOrderLogId,
          scopeId: recurringOrderLogItems.contractScopeId,
          quantity: recurringOrderLogItems.quantity,
          productId: orderItems.productId,
          itemQuantity: orderItems.quantity,
          orderId: orderItems.orderId,
        }).from(recurringOrderLogItems)
          .innerJoin(orderItems, eq(orderItems.id, recurringOrderLogItems.orderItemId))
          .where(inArray(recurringOrderLogItems.recurringOrderLogId, logIds))
      : [];

    const missing: MissingContractOccurrence[] = [];
    for (const scope of validCandidates as any[]) {
      const contracts = companyContracts.get(scope.companyId) ?? new Set<number>();
      const companyLogs = matchingLogs.filter((log: any) => log.companyId === scope.companyId);
      let reason: string | null = null;
      let contractId = scope.contractId;
      if (contracts.size !== 1) {
        reason = "CONTRATOS_VIGENTES_AMBIGUOS";
      } else {
        contractId = [...contracts][0];
        const log = companyLogs.find((candidate: any) => candidate.contractId === contractId && candidate.orderId != null);
        if (!log) {
          reason = "OCORRENCIA_CONTRATUAL_SEM_PEDIDO_MATERIALIZADO";
        } else {
          const item = mappings.find((candidate: any) => candidate.logId === log.id && candidate.scopeId === scope.scopeId);
          if (!item || item.orderId !== log.orderId || item.productId !== scope.productId || Number(item.quantity) !== Number(scope.quantity) || Number(item.itemQuantity) !== Number(scope.quantity)) {
            reason = "OCORRENCIA_SEM_VINCULO_VALIDO_DO_ITEM";
          }
        }
      }
      if (reason) missing.push({
        companyId: scope.companyId,
        companyName: scope.companyName,
        contractId,
        contractScopeId: scope.scopeId,
        productId: scope.productId,
        productName: scope.productName,
        quantity: Number(scope.quantity),
        deliveryDate: productionDate,
        reason,
      });
    }
    return missing;
  },

  async getGlobalRoutesForDate(productionDate: string, executor: any = db) {
    assertProductionGlobalAccess();
    const rows = await executor.select({
      id: logisticsRoutes.id,
      name: logisticsRoutes.name,
      companyIds: logisticsRoutes.companyIds,
    }).from(logisticsRoutes).where(eq(logisticsRoutes.deliveryDate, productionDate));
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      companyIds: Array.isArray(row.companyIds) ? row.companyIds as number[] : [],
    }));
  },

  async findGlobalBatchByDate(productionDate: string, executor: any = db): Promise<ProductionBatch | null> {
    assertProductionGlobalAccess();
    const [batch] = await executor.select().from(productionBatches).where(and(
      eq(productionBatches.productionDate, productionDate),
      isNull(productionBatches.empresaId),
    )).limit(1);
    return batch ?? null;
  },

  async listGlobal(opts: { status?: string; date?: string; page: number; limit: number }) {
    assertProductionGlobalAccess();
    const rows = await db.select().from(productionBatches).where(and(
      isNull(productionBatches.empresaId),
      opts.status ? eq(productionBatches.status, opts.status) : undefined,
      opts.date ? eq(productionBatches.productionDate, opts.date) : undefined,
    )).orderBy(desc(productionBatches.productionDate)).limit(opts.limit).offset((opts.page - 1) * opts.limit);
    return rows;
  },

  async getGlobalBatchById(id: number): Promise<BatchWithItems> {
    assertProductionGlobalAccess();
    const [batch] = await db.select().from(productionBatches).where(and(
      eq(productionBatches.id, id), isNull(productionBatches.empresaId),
    )).limit(1);
    if (!batch) throw new NotFoundError("Lote global de produção não encontrado");
    const items = await db.select().from(productionBatchItems).where(eq(productionBatchItems.batchId, id)).orderBy(productionBatchItems.productName);
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

  async createGlobalBatchInTransaction(tx: any, productionDate: string, itemsData: Array<{
    productId: number; productName: string; category: string | null;
    productionClassification: "IN_NATURA" | "PROCESSADOS"; unit: string; totalQuantity: number;
    orderBreakdown: OrderBreakdownEntry[]; routeBreakdown: RouteBreakdownEntry[];
  }>): Promise<BatchWithItems> {
    assertProductionGlobalAccess();
    const [batch] = await tx.insert(productionBatches).values({
      empresaId: null,
      productionDate,
      status: "PENDENTE",
      generatedAt: new Date(),
    }).returning();
    if (itemsData.length) {
      await tx.insert(productionBatchItems).values(itemsData.map((item) => ({
        batchId: batch.id,
        productId: item.productId,
        productName: item.productName,
        category: item.category,
        productionClassification: item.productionClassification,
        unit: item.unit,
        totalQuantity: String(item.totalQuantity),
        checkedQuantity: "0",
        orderBreakdown: item.orderBreakdown,
        routeBreakdown: item.routeBreakdown,
      })));
    }
    const items = await tx.select().from(productionBatchItems).where(eq(productionBatchItems.batchId, batch.id)).orderBy(productionBatchItems.productName);
    return {
      ...batch,
      items: items.map((item: any) => ({
        ...item,
        totalQuantity: String(item.totalQuantity),
        checkedQuantity: String(item.checkedQuantity ?? "0"),
        orderBreakdown: (item.orderBreakdown as OrderBreakdownEntry[]) ?? [],
        routeBreakdown: (item.routeBreakdown as RouteBreakdownEntry[]) ?? [],
      })),
    };
  },

  async updateGlobalStatus(id: number, status: string, notes?: string) {
    assertProductionGlobalAccess();
    const [updated] = await db.update(productionBatches).set({
      status, ...(notes !== undefined ? { notes } : {}), updatedAt: new Date(),
    }).where(and(eq(productionBatches.id, id), isNull(productionBatches.empresaId))).returning();
    if (!updated) throw new NotFoundError("Lote global de produção não encontrado");
    return updated;
  },

  async updateGlobalItemCheck(itemId: number, checkedQuantity: number, notes?: string) {
    assertProductionGlobalAccess();
    const [updated] = await db.update(productionBatchItems).set({
      checkedQuantity: String(checkedQuantity), ...(notes !== undefined ? { notes } : {}),
    }).where(and(eq(productionBatchItems.id, itemId), exists(
      db.select({ id: productionBatches.id }).from(productionBatches).where(and(
        eq(productionBatches.id, productionBatchItems.batchId), isNull(productionBatches.empresaId),
      )),
    ))).returning();
    if (!updated) throw new NotFoundError("Item global de produção não encontrado");
    return updated;
  },

  async deleteGlobalBatch(id: number): Promise<void> {
    assertProductionGlobalAccess();
    await db.delete(productionBatches).where(and(eq(productionBatches.id, id), isNull(productionBatches.empresaId)));
  },

  /**
   * Fetch all orders items for a given delivery date and status filter.
   * Used by the service to build a production batch.
   */
  async getRawOrderItemsForDate(
    empresaId: number | null,
    productionDate: string,
  ): Promise<RawOrderItemRow[]> {
    assertProductionTenantScope(empresaId);
    const rows = await db
      .select({
        itemId: orderItems.id,
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
        workflowStatus: orders.workflowStatus,
        productionOrigin: orders.productionOrigin,
        productionClassification: products.productionClassification,
        specialRequestApprovedAndMaterialized: exists(
          db.select({ id: specialOrderRequests.id }).from(specialOrderRequests)
            .where(and(
              eq(specialOrderRequests.generatedOrderId, orders.id),
              eq(specialOrderRequests.companyId, orders.companyId),
              eq(specialOrderRequests.status, "APPROVED"),
            )),
        ),
        contractOccurrenceValid: contractualOccurrenceForItem(productionDate),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .innerJoin(companies, eq(orders.companyId, companies.id))
      .where(
        and(
          // Delivery date matches production date
          sql`DATE(${orders.deliveryDate}) = ${productionDate}`,
          inArray(orders.workflowStatus, ["APPROVED", "PENDING_APPROVAL"]),
          // Tenant scope (null = cross-tenant MASTER)
          empresaId != null ? eq(orders.companyId, empresaId) : undefined,
        ),
      );

    return rows.filter((row) => isProductionOrderEligible({
      workflowStatus: row.workflowStatus,
      origin: row.productionOrigin as any,
      contractOccurrenceValid: row.contractOccurrenceValid === true,
      specialRequestApprovedAndMaterialized: row.specialRequestApprovedAndMaterialized === true,
    })).map((r) => ({
      ...r,
      quantity: Number(r.quantity),
      productionClassification:
        r.productionClassification === "IN_NATURA" || r.productionClassification === "PROCESSADOS"
          ? r.productionClassification
          : null,
      specialRequestApprovedAndMaterialized: r.specialRequestApprovedAndMaterialized === true,
      contractOccurrenceValid: r.contractOccurrenceValid === true,
    }));
  },

  /**
   * Fetch logistics routes for a given delivery date to build route breakdown.
   */
  async getRoutesForDate(
    empresaId: number | null,
    productionDate: string,
  ): Promise<Array<{ id: number; name: string; companyIds: number[] }>> {
    assertProductionTenantScope(empresaId);
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
    assertProductionTenantScope(empresaId);
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
    assertProductionTenantScope(empresaId);
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
  async getById(
    id: number,
    empresaId: number | null,
  ): Promise<BatchWithItems> {
    assertProductionTenantScope(empresaId);
    const [batch] = await db
      .select()
      .from(productionBatches)
      .where(
        and(
          eq(productionBatches.id, id),
          // null is reserved for an explicitly cross-tenant admin context.
          empresaId != null
            ? eq(productionBatches.empresaId, empresaId)
            : undefined,
        ),
      )
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
    assertProductionTenantScope(batchData.empresaId, "write");
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
    empresaId: number | null,
    status: string,
    notes?: string,
  ): Promise<ProductionBatch> {
    assertProductionTenantScope(empresaId, "write");
    const [updated] = await db
      .update(productionBatches)
      .set({
        status,
        ...(notes !== undefined ? { notes } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productionBatches.id, id),
          empresaId != null
            ? eq(productionBatches.empresaId, empresaId)
            : undefined,
        ),
      )
      .returning();
    if (!updated) throw new NotFoundError("Lote de produção não encontrado");
    return updated;
  },

  /** Update item checked quantity. */
  async updateItemCheck(
    itemId: number,
    empresaId: number | null,
    checkedQuantity: number,
    notes?: string,
  ): Promise<ProductionBatchItem> {
    assertProductionTenantScope(empresaId, "write");
    const [updated] = await db
      .update(productionBatchItems)
      .set({
        checkedQuantity: String(checkedQuantity),
        ...(notes !== undefined ? { notes } : {}),
      })
      .where(
        and(
          eq(productionBatchItems.id, itemId),
          empresaId != null
            ? exists(
                db
                  .select({ id: productionBatches.id })
                  .from(productionBatches)
                  .where(
                    and(
                      eq(productionBatches.id, productionBatchItems.batchId),
                      eq(productionBatches.empresaId, empresaId),
                    ),
                  ),
              )
            : undefined,
        ),
      )
      .returning();
    if (!updated) throw new NotFoundError("Item não encontrado");
    return updated;
  },

  /** Delete a batch (cascades to items). */
  async deleteBatch(id: number, empresaId: number | null): Promise<void> {
    assertProductionTenantScope(empresaId, "write");
    await db
      .delete(productionBatches)
      .where(
        and(
          eq(productionBatches.id, id),
          empresaId != null
            ? eq(productionBatches.empresaId, empresaId)
            : undefined,
        ),
      );
  },
};
