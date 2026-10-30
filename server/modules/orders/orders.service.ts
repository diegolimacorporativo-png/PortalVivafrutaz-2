import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  OperationalDeadlineError,
  UnauthorizedError,
} from "../../shared/errors/AppError";
import { inArray } from "drizzle-orm";
import { db } from "../../database/db";
import { orders as ordersTable, orderItems as orderItemsTable } from "@shared/schema";
import { ordersRepository, OrdersRepository } from "./orders.repository";
import { getRequestIdForLog } from "../../core/context/requestContext";
import { currentTenantId, requireTenantId } from "../../core/tenant/context";
import {
  calculateOrderModificationDeadline,
  ORDER_MODIFICATION_EXPIRED_MESSAGE,
  REOPENED_ORDER_EXPIRED_MESSAGE,
} from "../../utils/orderDeadline";
// FASE 9D — safe async observability for afterCreate
import { logSecurity } from "../../core/security/securityLogger";
import { auditLog } from "../../utils/auditLogger";
// FASE NF.7.9.2 — guard de fechamento mensal. Bloqueia mutação em pedido
// cujo `createdAt` cai num mês já consolidado para a empresa. NÃO altera
// qualquer caminho de leitura nem a ausência de fechamento (default = aberto).
import { isPeriodClosed } from "../../services/fiscal/fiscal-closure.service";
import type { Order, OrderDetail, OrdersListFilter } from "./orders.types";
import {
  OrderStatus,
  legacyStatusFor,
  assertTransitionAllowed,
  assertTransitionRole,
  validateBusinessRules,
} from "./orders.workflow";
import { fireNotification } from "../../services/pushService";
import {
  sendOrderPlaced,
  sendOrderStatusChanged,
  sendAdminNewOrder,
} from "../../services/mailer";
// Price resolver is authoritative when a company administrative fee is set
// or the legacy full pricing rollout is enabled.
import {
  resolveProductPrice,
  logPriceDivergence,
} from "../products/utils/priceResolver";
import { shouldResolveCompanyPricing } from "./companyPricing";
import { customerOrderIntentMatches } from "./order-confirmation";
import { retryCustomerConfirmations } from "./customer-confirmation-retry";
import {
  calculateWeeklyBillingTotal,
  minimumWeeklyBillingMessage,
  type WeeklyBillingOrder,
} from "./weekly-billing";

/**
 * Roles allowed to delete orders. Replicated from legacy.
 */
const DELETE_ROLES = ["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"] as const;

/**
 * Roles allowed to act on reopen requests (approve/deny).
 */
const REOPEN_ADMIN_ROLES = [
  "ADMIN",
  "DIRECTOR",
  "OPERATIONS_MANAGER",
  "LOGISTICS",
] as const;

/**
 * Roles allowed to view DANFE logs / record DANFE generation events.
 */
const DANFE_ROLES = [
  "ADMIN",
  "DIRECTOR",
  "FINANCEIRO",
  "LOGISTICS",
  "DEVELOPER",
  "OPERATIONS_MANAGER",
] as const;

/**
 * Roles allowed to operate fiscal/ERP exports.
 */
export const FISCAL_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "FINANCEIRO",
  "DEVELOPER",
  "PURCHASE_MANAGER",
] as const;

/**
 * Caller context — derived from `req.session` by the controller and passed
 * into every mutating service call. Keeping this typed makes it explicit
 * what "current user" data the service may use, and makes the service unit
 * testable without an Express request.
 */
export interface ActorContext {
  userId?: number;
  companyId?: number;
  ip?: string;
  role?: string;
  email?: string;
}

/**
 * OrdersService — business rules of the orders module.
 *
 * Architecture decision: services own *behavior*. They orchestrate the
 * repository, enforce invariants, and never touch req/res. Side-effects
 * (push, email, and auto-logistics) are kept fire-and-forget where they are
 * non-critical, so a transient failure in
 * a downstream system never fails the primary operation.
 *
 * SCOPE NOTE: every workflow here is a faithful port of the legacy
 * `routes.ts` handler — no behavior change, only structural relocation.
 * Any tightening (replacing fire-and-forget with proper transactions, role
 * audits, idempotency keys, etc.) is a SEPARATE follow-up.
 */
export class OrdersService {
  constructor(private readonly repo: OrdersRepository = ordersRepository) {}

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ READS                                                            ║
  // ╚══════════════════════════════════════════════════════════════════╝

  // ── FASE FIN.2 — Helpers de projeção de pagamento (somente leitura) ──
  // Não mexe em nenhum fluxo financeiro nem em schema. Apenas deriva do AR
  // já existente vinculado pelo `accounts_receivable.orderId`.
  //
  // Contrato fail-safe: qualquer erro/AR ausente retorna
  // `{ isPaid: false, paidAt: null }` — assim a leitura de pedidos jamais
  // quebra por causa do módulo financeiro.

  /**
   * FASE FIN.2 — Helper público. Retorna `true` somente quando existe AR
   * vinculada ao pedido e seu status é exatamente `"pago"`.
   *
   * Garantias:
   *   - Nunca lança erro (try/catch interno).
   *   - Não altera estado, não dispara efeitos colaterais.
   *   - Reusa `repo.getAccountReceivableByOrderId` (idempotente, multi-tenant).
   */
  async isOrderPaid(orderId: number): Promise<boolean> {
    try {
      const ar = await this.repo.getAccountReceivableByOrderId(orderId);
      return Boolean(ar && ar.status === "pago");
    } catch (err) {
      console.warn("[FIN.2] isOrderPaid falhou (fail-safe → false)", {
        orderId,
        err: (err as Error)?.message,
      });
      return false;
    }
  }

  /**
   * FASE FIN.2 — Helper privado. Retorna a projeção completa
   * `{ isPaid, paidAt }` derivada do AR vinculado. Usado para enriquecer
   * o response de `get()` / `list()` / `listByCompany()` sem alterar o
   * schema de `orders`.
   */
  private async getPaymentProjection(
    orderId: number,
  ): Promise<{ isPaid: boolean; paidAt: Date | null }> {
    try {
      const ar = await this.repo.getAccountReceivableByOrderId(orderId);
      if (!ar) return { isPaid: false, paidAt: null };
      const isPaid = ar.status === "pago";
      const raw = (ar as any).pagoEm;
      const paidAt =
        raw instanceof Date ? raw : raw ? new Date(raw) : null;
      return { isPaid, paidAt };
    } catch (err) {
      console.warn("[FIN.2] getPaymentProjection falhou (fail-safe)", {
        orderId,
        err: (err as Error)?.message,
      });
      return { isPaid: false, paidAt: null };
    }
  }

  /**
   * T604 — Batch version of getPaymentProjection.
   * Fetches all AR rows for the given orders in ONE query, then enriches
   * each order in-memory. Complexity: O(1) query + O(N) map lookups.
   * Fail-safe: any DB error falls through to isPaid=false for every row.
   */
  private async enrichWithPaymentProjectionsBulk(orders: any[]): Promise<any[]> {
    if (orders.length === 0) return [];
    try {
      const ids = orders.map((o) => o.id as number);
      const arMap = await this.repo.getAccountReceivablesByOrderIds(ids);
      return orders.map((o) => {
        const ar = arMap[o.id];
        if (!ar) return { ...o, isPaid: false, paidAt: null };
        const isPaid = ar.status === "pago";
        const raw = ar.pagoEm;
        const paidAt = raw instanceof Date ? raw : raw ? new Date(raw) : null;
        return { ...o, isPaid, paidAt };
      });
    } catch (err) {
      console.warn("[FIN.2] enrichWithPaymentProjectionsBulk falhou (fail-safe)", {
        err: (err as Error)?.message,
      });
      return orders.map((o) => ({ ...o, isPaid: false, paidAt: null }));
    }
  }

  async list(filter: OrdersListFilter = {}): Promise<Order[]> {
    const orders = await this.repo.list(filter);
    // T604 — Replace N per-order AR lookups with a single batch query.
    return this.enrichWithPaymentProjectionsBulk(orders as any[]);
  }

  async get(id: number): Promise<OrderDetail> {
    // ── PASSO 5 — service.get entrada ────────────────────────────────────
    console.log('[DIAG][P5] service.get chamado', { id });
    const detail = await this.repo.get(id);
    // ── PASSO 6/7 — resultado do repo.get ────────────────────────────────
    console.log('[DIAG][P6] repo.get retornou', {
      found: !!detail,
      orderCode: (detail?.order as any)?.orderCode ?? null,
      orderCompanyId: (detail?.order as any)?.companyId ?? null,
      orderStatus: (detail?.order as any)?.status ?? null,
      itemsCount: detail?.items?.length ?? null,
    });
    if (!detail) {
      // ── PASSO 7 — undefined: causa exata ─────────────────────────────
      console.warn('[DIAG][P7] detail=undefined → CROSS_TENANT_404 ou pedido inexistente',
        `[SECURITY] CROSS_TENANT_404 | requestId=${getRequestIdForLog()} | orderId=${id} | details=Possible cross-tenant access (404)`,
      );
      throw new NotFoundError("Pedido não encontrado");
    }
    // FASE FIN.2 — projeção aditiva. Mantém `.order` e `.items` intactos
    // (compat 100% com o frontend legado) e expõe `isPaid` + `paidAt` no
    // mesmo nível para consumo direto.
    const projection = await this.getPaymentProjection(id);
    const result = { ...detail, ...projection };
    // ── PASSO 10 — o que o backend vai enviar ────────────────────────────
    console.log('[DIAG][P10-SERVER] service.get retornando', {
      orderCode: (result.order as any)?.orderCode ?? null,
      itemsCount: result.items?.length ?? null,
      isPaid: (result as any).isPaid ?? null,
      topLevelKeys: Object.keys(result),
    });
    return result;
  }

  async listByCompany(companyId: number): Promise<Order[]> {
    const orders = await this.repo.listByCompany(companyId);
    // T604 — batch AR lookup instead of N per-order queries.
    return this.enrichWithPaymentProjectionsBulk(orders as any[]);
  }

  async listReopenRequests(actor: ActorContext): Promise<Order[]> {
    if (!actor.userId) throw new UnauthorizedError();
    const all = await this.repo.list();
    return all.filter((o: any) => o.status === "REOPEN_REQUESTED");
  }

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ EXPORT (read-heavy report)                                       ║
  // ╚══════════════════════════════════════════════════════════════════╝

  /**
   * Faithful port of `GET /api/orders/export`. Returns the enriched payload
   * (order + items + product/company joins) used by the admin reports page.
   */
  async export(filters: {
    dateFrom?: string;
    dateTo?: string;
    companyId?: string | number;
    orderType?: string;
  }): Promise<any[]> {
    const { dateFrom, dateTo, companyId, orderType } = filters;
    const [allOrders, allCompanies, allProducts] = await Promise.all([
      this.repo.list(),
      this.repo.getCompanies(),
      this.repo.getProducts(),
    ]);

    let filtered: any[] = allOrders as any[];
    if (dateFrom) {
      const from = new Date(dateFrom);
      filtered = filtered.filter((o) => new Date(o.orderDate) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      filtered = filtered.filter((o) => new Date(o.orderDate) <= to);
    }
    if (companyId && companyId !== "all") {
      filtered = filtered.filter((o) => o.companyId === Number(companyId));
    }
    if (orderType && orderType !== "all") {
      if (orderType === "teste") {
        filtered = filtered.filter(
          (o) =>
            o.orderCode?.includes("TESTE") || o.weekReference?.includes("TESTE"),
        );
      } else {
        filtered = filtered.filter((o) => {
          const company = (allCompanies as any[]).find(
            (c) => c.id === o.companyId,
          );
          return company?.clientType === orderType;
        });
      }
    }

    // T604 — Batch-fetch all items for filtered orders in ONE query.
    // Previously: N calls to repo.get(order.id) inside Promise.all → N+1.
    // Now: 1 bulk query → O(1) DB round-trip regardless of result set size.
    const filteredIds = filtered.map((o: any) => o.id as number);
    let itemsByOrderId: Record<number, any[]> = {};
    try {
      itemsByOrderId = await this.repo.getItemsByOrderIds(filteredIds);
    } catch {
      /* fail-safe: itemsByOrderId stays empty, items arrays will be [] */
    }

    // Build lookup maps for O(1) joins in memory.
    const companyMap = new Map((allCompanies as any[]).map((c) => [c.id, c]));
    const productMap = new Map((allProducts as any[]).map((p) => [p.id, p]));

    return filtered.map((order) => {
        const company = companyMap.get(order.companyId);
        const items: any[] = itemsByOrderId[order.id] ?? [];
        return {
          ...order,
          companyName: company?.companyName || `Empresa #${order.companyId}`,
          clientType: company?.clientType || "",
          items: items.map((item: any) => {
            const product = productMap.get(item.productId);
            return {
              ...item,
              productName: product?.name || `Produto #${item.productId}`,
              productCategory: product?.category || "",
              productUnit: product?.unit || "",
            };
          }),
        };
      });
  }

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ CREATE                                                           ║
  // ╚══════════════════════════════════════════════════════════════════╝

  /** Rebuild order line prices from the server catalog for the owning company. */
  private async resolveCompanyOrderItems(companyId: number, items: any[]): Promise<any[]> {
    const company: any = await this.repo.getCompany(companyId);
    if (!company) throw new BadRequestError("Empresa não encontrada para calcular os preços do pedido.");
    if (!shouldResolveCompanyPricing(company)) return items;

    const fee = Number(company.adminFee ?? 0);
    const productCache = new Map<number, any>();
    const subCategoryCache = new Map<number, any>();
    const contractCache = new Map<number, any>();
    const resolvedItems: any[] = [];

    for (const item of items ?? []) {
      const productId = Number(item.productId);
      if (!Number.isInteger(productId) || productId <= 0) {
        if (Number.isFinite(fee) && fee > 0) {
          throw new BadRequestError("Não foi possível validar um produto para aplicar a taxa administrativa.");
        }
        resolvedItems.push(item);
        continue;
      }

      let product = productCache.get(productId);
      if (!product) {
        product = await this.repo.getProductById(productId);
        if (product) productCache.set(productId, product);
      }
      if (!product) {
        if (Number.isFinite(fee) && fee > 0) {
          throw new BadRequestError("Não foi possível validar um produto para aplicar a taxa administrativa.");
        }
        resolvedItems.push(item);
        continue;
      }

      let subCategoryPrice: number | null = null;
      if (item.subCategoryId != null) {
        const subCategoryId = Number(item.subCategoryId);
        let subCategory = subCategoryCache.get(subCategoryId);
        if (subCategory === undefined) {
          subCategory = await this.repo.getProductSubCategoryById(subCategoryId);
          subCategoryCache.set(subCategoryId, subCategory ?? null);
        }
        if (subCategory && Number(subCategory.productId) !== productId) {
          throw new BadRequestError("A categoria selecionada não pertence ao produto do pedido.");
        }
        const rawPrice = subCategory?.price;
        if (rawPrice != null && Number.isFinite(Number(rawPrice))) {
          subCategoryPrice = Number(rawPrice);
        }
      }

      let contractPrice: number | null = null;
      let contractScope = contractCache.get(productId);
      if (contractScope === undefined) {
        contractScope = await this.repo.getContractScope(companyId, productId);
        contractCache.set(productId, contractScope ?? null);
      }
      const rawContractPrice = contractScope?.unitPrice;
      if (rawContractPrice != null && Number.isFinite(Number(rawContractPrice))) {
        contractPrice = Number(rawContractPrice);
      }
      // Match the customer catalog: company-specific contract scope wins;
      // otherwise use the company's price-group entry before category/base.
      if (contractPrice == null && company.priceGroupId != null) {
        const priceGroupEntry = await this.repo.getPriceGroupPrice(companyId, productId);
        const rawGroupPrice = priceGroupEntry?.price;
        if (rawGroupPrice != null && Number.isFinite(Number(rawGroupPrice))) {
          contractPrice = Number(rawGroupPrice);
        }
      }

      const unitPrice = resolveProductPrice({
        basePrice: Number(product.basePrice),
        subCategoryPrice,
        contractPrice,
        adminFee: Number.isFinite(fee) ? fee : 0,
      });
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new BadRequestError("Não foi possível calcular o preço atualizado do produto.");
      }
      const quantity = Number(item.quantity ?? 0);
      resolvedItems.push({
        ...item,
        unitPrice: unitPrice.toFixed(2),
        totalPrice: (unitPrice * quantity).toFixed(2),
      });
    }

    return resolvedItems;
  }

  /**
   * `POST /api/orders` — create a customer-facing order.
   *
   * Replicates the legacy flow exactly:
   *   1. Maintenance-mode block (503).
   *   2. Test-mode interception (per-user `testMode` / role `SISTEMA_TESTE`,
   *      then global `test_mode` setting for client sessions).
   *   3. 60-second duplicate guard.
   *   4. Date-lock guard (one active order per company per delivery date).
   *   5. Persist with CUSTOMER_CONFIRMED, then attempt operational release.
   *   6. Emit post-release communication and ensure the delivery exists.
   *
   * Returns either the persisted Order or a "test order" payload identical
   * to the legacy 201 response shape.
   */
  async create(
    body: { order: any; items: any[] },
    actor: ActorContext,
    tx?: any,
  ): Promise<{ data: any; isTest: boolean; status: 201; newlyCreated?: boolean; operationalReleasePending?: boolean }> {
    const companyId = actor.companyId ?? requireTenantId();
    const order = { ...body.order, companyId };
    const items = body.items;

    // [DIAG-5] Service reached
    console.log("[ORDER_CREATE][5_SERVICE] service.create reached", {
      actorUserId: actor.userId,
      actorCompanyId: actor.companyId,
      orderCompanyId: order?.companyId,
      orderDeliveryDate: order?.deliveryDate,
      orderTotalValue: order?.totalValue,
      itemCount: items?.length,
      itemProductIds: items?.map((i: any) => i.productId),
    });

    // 1) maintenance-mode block (only client sessions)
    const maintenanceMode = await this.repo.getSetting("maintenance_mode");
    if (maintenanceMode === "true" && actor.companyId) {
      throw new AppError(
        "Sistema em manutenção. Pedidos temporariamente desabilitados.",
        503,
        "SERVICE_UNAVAILABLE",
      );
    }

    // 2a) per-user test mode (any session with userId)
    if (actor.userId) {
      const actingUser = await this.repo.getUser(actor.userId);
      if (
        actingUser &&
        (actingUser.role === "SISTEMA_TESTE" ||
          (actingUser as any).testMode === true)
      ) {
        const company = await this.repo.getCompany(order.companyId);
        const year = new Date().getFullYear();
        const testCode = `TESTE-${year}-${String(Date.now()).slice(-6)}`;
        const testOrder = await this.repo.createTestOrder({
          orderCode: testCode,
          companyId: order.companyId,
          companyName: company?.companyName || `Empresa #${order.companyId}`,
          deliveryDate: new Date(order.deliveryDate),
          weekReference: order.weekReference,
          totalValue: order.totalValue,
          orderNote: order.orderNote || null,
          items,
          createdBy: actingUser.id,
        });
        return {
          data: {
            ...testOrder,
            id: (testOrder as any).id,
            orderCode: testCode,
            vfCode: testCode,
            isTestOrder: true,
          },
          isTest: true,
          status: 201,
        };
      }
    }

    // 2b) global test_mode interception (client sessions only)
    const testMode = await this.repo.getSetting("test_mode");
    if (testMode === "true" && actor.companyId) {
      const company = await this.repo.getCompany(order.companyId);
      const year = new Date().getFullYear();
      const testCode = `TESTE-${year}-${String(Date.now()).slice(-6)}`;
      const testOrder = await this.repo.createTestOrder({
        orderCode: testCode,
        companyId: order.companyId,
        companyName: company?.companyName || `Empresa #${order.companyId}`,
        deliveryDate: new Date(order.deliveryDate),
        weekReference: order.weekReference,
        totalValue: order.totalValue,
        orderNote: order.orderNote || null,
        items,
      });
      await this.repo.createLog({
        action: "TEST_ORDER_CREATED",
        description: `Pedido de teste criado: ${testCode}`,
        companyId: order.companyId,
        userRole: "CLIENT",
        level: "INFO",
      });
      return {
        data: {
          ...testOrder,
          id: (testOrder as any).id,
          orderCode: testCode,
          vfCode: testCode,
          isTestOrder: true,
        },
        isTest: true,
        status: 201,
      };
    }

    // Recalculate from the authenticated company's server-side prices before any
    // weekly minimum check or persistence. This also prevents stale browser
    // prices from bypassing a newly configured administrative fee.
    const pricedItems = await this.resolveCompanyOrderItems(Number(order.companyId), items);

    const requestedDate = new Date(order.deliveryDate);
    const requestedDateStr = requestedDate.toISOString().split("T")[0];

    // createProgramacao validates the complete week's items once before
    // opening its transaction. Do not re-validate each individual day here:
    // the first day could be below the weekly minimum even when the full
    // submitted week reaches it.
    if (!tx) {
      await this.assertMinimumWeeklyBilling({
        companyId,
        weekReference: order.weekReference,
        candidateItems: pricedItems,
      });
    }

    // A durable slot lock replaces the per-process debounce. It serializes
    // same-company/same-day confirmations across Node processes. Existing
    // intermediate orders are resumed only when their requested contents match.
    if (!tx) {
      const persisted = await db.transaction((creationTx) =>
        this.create({ order, items }, actor, creationTx),
      );
      return this.finishCustomerConfirmation(persisted, actor);
    }
    await this.repo.lockCreationSlot(companyId, requestedDateStr, tx);
    const existingForSlot = await this.repo.findForCreationSlot(companyId, requestedDateStr, tx);
    const { normalisedItems, normalisedTotal } = this._normaliseItems(pricedItems, order);
    if (existingForSlot.length > 1) {
      throw new ConflictError("Há mais de um pedido ativo para essa data. A equipe precisa revisar os registros antes de retomar.", {
        existingOrderIds: existingForSlot.map((entry) => entry.order.id),
      });
    }
    const existing = existingForSlot[0];
    if (existing) {
      const sameIntent = customerOrderIntentMatches(
        existing.order,
        existing.items,
        order,
        normalisedItems,
      );
      if (!sameIntent) {
        throw new ConflictError("Já existe um pedido diferente para essa data de entrega.", {
          existingOrderId: existing.order.id,
          existingOrderCode: existing.order.orderCode,
        });
      }
      if (![OrderStatus.CUSTOMER_CONFIRMED, OrderStatus.APPROVED].includes(existing.order.workflowStatus as any)) {
        throw new ConflictError("Já existe um pedido em outro fluxo para essa data.", {
          existingOrderId: existing.order.id,
          existingOrderCode: existing.order.orderCode,
        });
      }
      return { data: existing.order, isTest: false, status: 201, newlyCreated: false };
    }

    // 5) persist
    // Auto-normalise items: compute totalPrice = unitPrice × quantity if absent.
    // This guards against API callers that provide unitPrice+quantity but omit
    // totalPrice — the DB column is NOT NULL so an absent value causes a 500.
    // Auto-compute totalValue from normalised items when the caller omits it.
    const newOrder = await this.repo.create(
      { ...order, status: "ACTIVE", workflowStatus: OrderStatus.CUSTOMER_CONFIRMED, totalValue: normalisedTotal },
      normalisedItems,
      tx,
    );

    return { data: newOrder, isTest: false, status: 201, newlyCreated: true };
  }

  private async finishCustomerConfirmation(
    result: { data: any; isTest: boolean; status: 201; newlyCreated?: boolean },
    actor: ActorContext,
  ): Promise<{ data: any; isTest: boolean; status: 201; newlyCreated?: boolean; operationalReleasePending?: boolean }> {
    if (result.isTest) return result;
    const current = await this.repo.get(Number(result.data.id));
    if (!current) throw new NotFoundError("Pedido confirmado não encontrado");
    let releasedNow = false;
    if (current.order.workflowStatus === OrderStatus.CUSTOMER_CONFIRMED) {
      try {
        await this.transition(Number(current.order.id), OrderStatus.APPROVED, actor, undefined, true);
        releasedNow = true;
      } catch (error: any) {
        // The confirmation is durable; failed business or transient release
        // checks leave it resumable in CUSTOMER_CONFIRMED.
        const status = Number(error?.status ?? 0);
        const failureType = status >= 400 && status < 500 ? "business" : "technical";
        logSecurity(`[ORDER_OPERATIONAL_RELEASE_PENDING] orderId=${current.order.id} | type=${failureType} | code=${error?.code ?? "unknown"} | status=${status || "unknown"}`);
      }
    }
    const finalDetail = await this.repo.get(Number(result.data.id));
    if (!finalDetail) throw new NotFoundError("Pedido confirmado não encontrado");
    if (releasedNow) {
      setImmediate(async () => {
        try {
          await this.afterCreate(finalDetail.order, finalDetail.order, finalDetail.items, "CLIENT");
        } catch (err: any) {
          logSecurity(`[ORDER_AFTER_CREATE_FAILED] orderId=${finalDetail.order.id} | error=${err?.message ?? "unknown"}`);
        }
      });
    }
    const operationalReleasePending = finalDetail.order.workflowStatus === OrderStatus.CUSTOMER_CONFIRMED;
    return {
      ...result,
      data: { ...finalDetail.order, operationalReleasePending },
      operationalReleasePending,
    };
  }

  /**
   * `POST /api/orders/programacao` — Programação Semanal.
   *
   * Creates one order per delivery day for the full week in a single request.
   * Enforces the company's minimum weekly billing against the TOTAL of all
   * submitted days before persisting anything. Each day's order still passes
   * through the existing `create()` pipeline (maintenance mode, test mode,
   * date-lock guard, side-effects).
   */
  async createProgramacao(
    body: {
      days: Array<{
        companyId?: number;
        deliveryDate: string;
        weekReference: string;
        totalValue: string;
        orderNote?: string | null;
        items: any[];
      }>;
    },
    actor: ActorContext,
  ): Promise<{ orders: any[] }> {
    const { days } = body;

    if (!days || days.length === 0) {
      throw new BadRequestError("Nenhum dia informado na programação.");
    }

    // Only process days that actually have items
    const activeDays = days.filter(d => d.items && d.items.length > 0);
    if (activeDays.length === 0) {
      throw new BadRequestError("Adicione produtos em pelo menos um dia antes de enviar.");
    }

    // Enforce minimum weekly billing — checked against the WHOLE week's total,
    // not per individual order.
    const companyId = actor.companyId ?? requireTenantId();
    if (companyId) {
      const existingOrders = await this.repo.listByCompanyId(Number(companyId));
      const pricedCandidateItems = (
        await Promise.all(
          activeDays.map((day) =>
            this.resolveCompanyOrderItems(Number(companyId), day.items ?? []),
          ),
        )
      ).flat();
      await this.assertMinimumWeeklyBilling({
        companyId: Number(companyId),
        weekReference: activeDays[0].weekReference,
        candidateItems: pricedCandidateItems,
        existingOrders,
      });
    }

    // ACID transaction — real all-or-nothing guarantee.
    //
    // Every day's order is inserted inside the SAME database transaction.
    // If any create() throws, drizzle automatically rolls back the entire
    // transaction — no manual compensation or delete-on-failure needed.
    //
    // Operational release happens after this creation transaction commits,
    // once per independent daily order. The weekly transaction is unchanged.
    const createdOrders: Array<{ result: any; order: any; items: any[] }> = [];
    const orderedDays = [...activeDays].sort((a, b) =>
      new Date(a.deliveryDate).toISOString().slice(0, 10).localeCompare(new Date(b.deliveryDate).toISOString().slice(0, 10)),
    );

    await db.transaction(async (tx) => {
      for (const day of orderedDays) {
        const result = await this.create(
          {
            order: {
              companyId,
              deliveryDate: day.deliveryDate,
              weekReference: day.weekReference,
              totalValue: day.totalValue,
              orderNote: day.orderNote ?? null,
              allowReplication: false,
            },
            items: day.items,
          },
          actor,
          tx,
        );
        createdOrders.push({ result, order: result.data, items: day.items });
      }
      // Any uncaught throw here causes drizzle to rollback automatically.
    });

    // Commit each independent day, then release operationally. A failure on
    // one day leaves that order resumable and does not undo other days.
    const finalized: any[] = [];
    for (const entry of createdOrders) {
      const result = await this.finishCustomerConfirmation(entry.result, actor);
      finalized.push(result.data);
    }

    return { orders: finalized };
  }

  /**
   * Internal creation pipeline — for system callers (cron jobs, admin tools)
   * that generate orders outside of a client HTTP request.
   *
   * Differences from `create()`:
   *   - No maintenance-mode / test-mode interception (system always writes).
   *   - No duplicate-submission window (system callers manage their own idempotency).
   *   - No date-lock guard (system callers are responsible for uniqueness).
   *   - Accepts the full order shape including `workflowStatus`, `isRecurring`, etc.
   *
   * Shared with `create()`:
   *   - Item totalPrice / order totalValue normalisation.
   *   - Persistence via `this.repo.create()` (same code path, same orderCode
   *     generation, same tenant guard).
   *   - `afterCreate` side-effects: audit log, push notification, emails,
   *     auto-logistics delivery creation.
   *
   * @param order  Plain order data (all DB fields accepted).
   * @param items  Line items (totalPrice auto-computed if absent).
   * @param ctx    Optional context for observability (e.g. `{ source: "recurring-cron" }`).
   * @returns      The persisted order row.
   */
  async createInternal(
    order: Record<string, any>,
    items: Array<Record<string, any>>,
    ctx: { source?: string; actorRole?: string } = {},
  ): Promise<any> {
    // — Validate tenant context before writing —
    if (order.companyId) {
      const tenant = await this.repo.getCompany(order.companyId);
      if (!tenant) {
        throw new BadRequestError(
          `Empresa ${order.companyId} não encontrada — contexto de tenant inválido`,
        );
      }
    }

    // — Normalise items and totalValue via shared helper —
    const pricedItems = order.companyId
      ? await this.resolveCompanyOrderItems(Number(order.companyId), items)
      : items;
    const { normalisedItems, normalisedTotal } = this._normaliseItems(pricedItems, order);

    // Cast to `any` mirrors `create()` — the caller is responsible for
    // providing a valid order shape (companyId, deliveryDate, etc.).
    const newOrder = await this.repo.create(
      { ...order, totalValue: normalisedTotal } as any,
      normalisedItems as any,
    );

    // — Fire afterCreate side-effects (non-blocking, same as create()) —
    const actorRole = ctx.actorRole ?? "SISTEMA";
    setImmediate(async () => {
      try {
        await this.afterCreate(newOrder, order, pricedItems, actorRole);
      } catch (err: any) {
        logSecurity(
          `[ORDER_AFTER_CREATE_FAILED] orderId=${newOrder.id} source=${ctx.source ?? "internal"} | error=${err?.message ?? "unknown"}`,
        );
      }
    });

    return newOrder;
  }

  /**
   * Normalises item totalPrice (unitPrice × quantity when absent) and
   * computes the order totalValue from the normalised items when the caller
   * omits it.  Extracted from create() / createInternal() to eliminate the
   * duplicated block that previously lived in both methods.
   */
  private _normaliseItems(
    items: any[],
    order: { totalValue?: any },
  ): { normalisedItems: any[]; normalisedTotal: string } {
    const normalisedItems = (items || []).map((it: any) => {
      if (it.totalPrice != null && it.totalPrice !== "") return it;
      const tp = (Number(it.unitPrice || 0) * Number(it.quantity || 0)).toFixed(2);
      return { ...it, totalPrice: tp };
    });
    // Backend is the authoritative source for order totals.
    // Always recompute from items — never trust the client-supplied totalValue.
    // This prevents R$ 0,00 orders caused by stale or manipulated client payloads.
    const normalisedTotal = String(
      normalisedItems
        .reduce((s: number, i: any) => s + Number(i.totalPrice || 0), 0)
        .toFixed(2),
    );
    return { normalisedItems, normalisedTotal };
  }

  /**
   * Side-effects fired after a successful create. Kept as one async function
   * so the controller can `void` it without blocking the response. Each
   * sub-step has its own try/catch so a downstream failure in (e.g.) email
   * never prevents push notifications or auto-logistics from running.
   *
   * @param actorRole  Role written to the audit log (defaults to "CLIENT" for
   *   backward compat; pass the real role from system/admin callers so the
   *   audit trail is accurate).
   */
  private async afterCreate(newOrder: any, order: any, items: any[], actorRole: string = "CLIENT") {
    // — Log creation —
    try {
      await this.repo.createLog({
        action: "ORDER_CREATED",
        description: `Pedido criado: ${newOrder.orderCode || `#${newOrder.id}`} (empresa ${order.companyId})`,
        companyId: order.companyId,
        userRole: actorRole,
      });
    } catch {
      /* swallow per legacy */
    }

    // — Push notification —
    try {
      const company = await this.repo.getCompany(order.companyId);
      const totalVal =
        typeof order.totalValue === "number"
          ? order.totalValue.toFixed(2)
          : parseFloat(String(order.totalValue || "0")).toFixed(2);
      fireNotification(
        "order_created",
        {
          company: company?.companyName || `Empresa #${order.companyId}`,
          items: String(items.length),
          value: totalVal,
          code: newOrder.vfCode || `#${newOrder.id}`,
        },
        { url: `/admin/orders`, companyId: order.companyId },
      );
    } catch {
      /* swallow per legacy */
    }

    // — Emails —
    try {
      const company = await this.repo.getCompany(order.companyId);
      if (company && newOrder) {
        const deliveryDay =
          (newOrder as any).deliveryDate || order.deliveryDate || "—";
        await sendOrderPlaced({
          toEmail: company.email,
          companyName: company.companyName,
          vfCode: (newOrder as any).vfCode || "",
          deliveryDay,
          totalItems: items.length,
        });
        const adminUsers = await this.repo.getUsers();
        const adminEmails = adminUsers
          .filter((u: any) => u.role === "ADMIN")
          .map((u: any) => u.email);
        for (const adminEmail of adminEmails) {
          await sendAdminNewOrder({
            adminEmail,
            companyName: company.companyName,
            vfCode: (newOrder as any).vfCode || "",
            deliveryDay,
          });
        }
      }
    } catch (emailErr) {
      console.error("[EMAIL] Erro ao enviar emails de pedido:", emailErr);
    }

    // — Auto-logistics —
    try {
      const co: any = await this.repo.getCompany(order.companyId);
      const delivDate = order.deliveryDate
        ? new Date(order.deliveryDate).toISOString().slice(0, 10)
        : null;
      const ensuredDelivery = await this.repo.ensureDeliveryForOrder({
        orderId: newOrder.id,
        companyId: order.companyId,
        status: "pendente",
        scheduledDate: delivDate,
        addressStreet: co?.addressStreet || null,
        addressNumber: co?.addressNumber || null,
        addressCity: co?.addressCity || null,
        addressState: co?.addressState || null,
        addressZip: co?.addressZip?.replace(/\D/g, "") || null,
        latitude: co?.latitude || null,
        longitude: co?.longitude || null,
        notes: `Auto-entrada: pedido ${(newOrder as any).vfCode || `#${newOrder.id}`}`,
      });
      if (ensuredDelivery.created) {
        console.log(
          `[AUTO-LOGISTICS] Entrega criada para pedido #${newOrder.id}`,
        );
      }
    } catch (autoErr) {
      console.error(
        "[AUTO-LOGISTICS] Erro ao criar entrega automática:",
        autoErr,
      );
    }
  }

  /**
   * `POST /api/orders/create-with-delivery` — admin-side creation that
   * always provisions a delivery row in the same call.
   *
   * Pipeline alignment (R1 finalisation):
   *   1. Validate actor + tenant context.
   *   2. Resolve prices (feature-flagged per company) — unique to this path.
   *   3. Normalise items/total via shared _normaliseItems() helper.
   *   4. Persist order via repo.create() with status ACTIVE.
   *   5. Persist delivery inline (synchronous, returns both to caller).
   *   6. Fire afterCreate() via setImmediate (audit log, push, emails).
   *      afterCreate's auto-logistics step skips if delivery already exists,
   *      so step 5 and afterCreate never duplicate the delivery row.
   */
  async createWithDelivery(
    body: any,
    actor: ActorContext,
  ): Promise<{ order: any; delivery: any }> {
    if (!actor.userId) throw new UnauthorizedError();
    const acting = await this.repo.getUser(actor.userId);
    if (!acting) throw new UnauthorizedError();

    const authorizedCompanyId = requireTenantId();
    const { companyId: requestedCompanyId, deliveryDate, items, ...rest } = body;
    const parsedCompanyId = Number(requestedCompanyId);
    if (!Number.isSafeInteger(parsedCompanyId) || parsedCompanyId <= 0) {
      throw new BadRequestError("companyId obrigatório");
    }
    if (parsedCompanyId !== authorizedCompanyId) {
      throw new ForbiddenError("Empresa não autorizada para esta operação");
    }
    const companyId = authorizedCompanyId;

    const totalValue = (items || []).reduce(
      (s: number, i: any) => s + Number(i.totalPrice || 0),
      0,
    );

    // Pre-fetch company — validate tenant context before any writes.
    const company: any = await this.repo.getCompany(companyId);
    if (!company || !company.active || company.isLocked) {
      throw new BadRequestError("A empresa selecionada não está disponível para novos pedidos.");
    }

    // ── Read-only divergence observation (no behavior change) ──
    // Compare the legacy unit price (already saved by the caller) against
    // what the new resolver would compute given the data already in scope.
    // Failures are swallowed — this MUST never affect the request flow.
    try {
      const markup =
        company && company.adminFee != null && company.adminFee !== ""
          ? Number(company.adminFee)
          : null;
      for (const it of items || []) {
        const legacy = Number(it.unitPrice);
        if (!Number.isFinite(legacy)) continue;
        const resolved = resolveProductPrice({
          basePrice: legacy,
          subCategoryPrice: null,
          priceGroupMarkup: Number.isFinite(markup as number) ? (markup as number) : null,
          contractPrice: null,
        });
        logPriceDivergence(
          {
            scope: "orders.service",
            method: "createWithDelivery",
            productId: it.productId,
            companyId,
          },
          legacy,
          resolved,
          { quantity: it.quantity },
        );
      }
    } catch (e) {
      console.warn("[priceResolver] observer error (createWithDelivery)", e);
    }

    // Recalculate prices whenever the company has an administrative fee;
    // `useNewPricing` still enables the full resolver for legacy companies
    // without a fee. The fee is tenant-specific and never mutates catalog prices.
    let computedTotal = totalValue;
    const adminFeeValue = Number(company?.adminFee ?? 0);
    const applyCompanyPricing = shouldResolveCompanyPricing(company);
    if (applyCompanyPricing) {
      try {
        const adminFee =
          company && company.adminFee != null && company.adminFee !== ""
            ? Number(company.adminFee)
            : 0;
        const productCache = new Map<number, any>();
        // STEP 4 — per-call cache of subCategory rows to avoid N queries
        // when many items share the same subCategoryId.
        const subCategoryCache = new Map<number, any>();
        // STEP 5 — per-call cache of contractScope rows keyed by
        // `${companyId}-${productId}` to avoid N queries when the same
        // product appears multiple times in the order.
        const contractCache = new Map<string, any>();
        for (const it of (items || []) as any[]) {
          let product = productCache.get(it.productId);
          if (!product) {
            product = await this.repo.getProductById(it.productId);
            if (product) productCache.set(it.productId, product);
          }
          if (!product) {
            if (Number.isFinite(adminFeeValue) && adminFeeValue > 0) {
              throw new BadRequestError("Não foi possível validar um produto para aplicar a taxa administrativa.");
            }
            continue;
          }
          // STEP 4 — resolve subCategoryPrice (optional). Fallback to
          // basePrice on any miss, invalid id, null price, or repo error.
          let subCategoryPrice: number | null = null;
          if (it.subCategoryId != null) {
            try {
              let sub = subCategoryCache.get(Number(it.subCategoryId));
              if (sub === undefined) {
                sub = await this.repo.getProductSubCategoryById(
                  Number(it.subCategoryId),
                );
                subCategoryCache.set(Number(it.subCategoryId), sub);
              }
              const raw = sub?.price;
              if (raw != null) {
                const n = Number(raw);
                if (Number.isFinite(n)) subCategoryPrice = n;
              }
            } catch (subErr) {
              console.warn("[pricing] subCategory lookup failed — fallback basePrice", {
                method: "createWithDelivery",
                productId: it.productId,
                subCategoryId: it.subCategoryId,
                err: (subErr as Error)?.message,
              });
              subCategoryPrice = null;
            }
          }
          // STEP 5 — resolve contractPrice (optional, highest priority).
          // Fallback to subCategory/base on any miss or repo error.
          let contractPrice: number | null = null;
          try {
            const cacheKey = `${companyId}-${it.productId}`;
            let scope = contractCache.get(cacheKey);
            if (scope === undefined) {
              scope = await this.repo.getContractScope(companyId, it.productId);
              contractCache.set(cacheKey, scope);
            }
            const rawCP = scope?.unitPrice;
            if (rawCP != null) {
              const n = Number(rawCP);
              if (Number.isFinite(n)) contractPrice = n;
            }
          } catch (cErr) {
            console.warn("[pricing] contract lookup failed — fallback subCategory/base", {
              method: "createWithDelivery",
              companyId,
              productId: it.productId,
              err: (cErr as Error)?.message,
            });
            contractPrice = null;
          }
          const newUnit = resolveProductPrice({
            basePrice: Number(product.basePrice),
            subCategoryPrice,
            contractPrice,
            adminFee,
          });
          if (!Number.isFinite(newUnit)) continue;
          it.unitPrice = String(newUnit.toFixed(2));
          it.totalPrice = String(
            (newUnit * Number(it.quantity || 0)).toFixed(2),
          );
          console.info("[pricing] category pricing applied", {
            scope: "orders.service",
            method: "createWithDelivery",
            productId: it.productId,
            subCategoryId: it.subCategoryId ?? null,
            usedSubCategory: subCategoryPrice !== null,
          });
          console.info("[pricing] contract pricing applied", {
            scope: "orders.service",
            method: "createWithDelivery",
            companyId,
            productId: it.productId,
            usedContract: contractPrice !== null,
          });
        }
        computedTotal = (items || []).reduce(
          (s: number, i: any) => s + Number(i.totalPrice || 0),
          0,
        );
        console.info("[pricing] new pricing ENABLED", {
          scope: "orders.service",
          method: "createWithDelivery",
          companyId,
        });
      } catch (e) {
        // Never accept client-submitted legacy prices when a company fee is
        // active and authoritative recalculation failed.
        console.error(
          "[pricing] company pricing recalculation failed",
          { companyId, err: (e as Error)?.message },
        );
        if (Number.isFinite(adminFeeValue) && adminFeeValue > 0) {
          throw new BadRequestError("Não foi possível atualizar os preços com a taxa administrativa. Tente novamente.");
        }
        computedTotal = totalValue;
      }
    }

    // Normalise items via the shared helper (guards against missing totalPrice
    // when the price resolver path is inactive, keeping parity with create()).
    // The resolver may already have updated unitPrice/totalPrice above;
    // _normaliseItems only fills gaps, never overwrites.
    const orderShapeForNorm = {
      totalValue: String(Math.round(computedTotal * 100) / 100),
    };
    const { normalisedItems: finalItems } = this._normaliseItems(items || [], orderShapeForNorm);

    const { order, delivery } = await this.repo.createOrderWithDelivery(
      {
        companyId,
        deliveryDate,
        totalValue: orderShapeForNorm.totalValue,
        status: "ACTIVE",
        orderDate: new Date(),
        fiscalStatus: "nota_pendente",
        erpExportStatus: "nao_exportado",
        ...rest,
      } as any,
      finalItems,
      {
        status: "pendente",
        scheduledDate: deliveryDate || null,
        addressStreet: company?.addressStreet || null,
        addressZip: company?.addressZip || null,
        addressCity: company?.addressCity || null,
        addressState: company?.addressState || null,
      },
    );

    // Fire the official afterCreate pipeline (audit log, push notification,
    // emails).  afterCreate's auto-logistics step checks for an existing
    // delivery before creating one, so the row we just persisted above is
    // discovered and skipped — no duplication.
    const orderBodyForAfterCreate = { companyId, deliveryDate, totalValue: order.totalValue, ...rest };
    setImmediate(async () => {
      try {
        await this.afterCreate(order, orderBodyForAfterCreate, finalItems, acting.role ?? "ADMIN");
      } catch (err: any) {
        logSecurity(
          `[ORDER_AFTER_CREATE_FAILED] orderId=${order.id} source=createWithDelivery | error=${err?.message ?? "unknown"}`,
        );
      }
    });

    return { order, delivery };
  }

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ UPDATE                                                           ║
  // ╚══════════════════════════════════════════════════════════════════╝

  /**
   * `PATCH /api/orders/:id` — preserves note/expiration edits and routes
   * supported legacy status changes through the controlled workflow.
   */
  async update(
    id: number,
    body: { status?: string; adminNote?: string; nimbiExpiration?: string | null; [k: string]: any },
    actor: ActorContext = {},
  ): Promise<Order> {
    // FASE NF.7.9.2 — guard de fechamento mensal. Roda ANTES de qualquer
    // escrita. Se o pedido caiu num mês já fechado para a empresa, recusa
    // com 403. Se o pedido não existir / não tiver createdAt / não houver
    // tenant no contexto, segue normal (default = aberto, fail-open).
    await this.assertPeriodOpen(id, "update");

    const { status, adminNote, nimbiExpiration } = body;
    let currentOrder: Order | undefined;
    let statusChanged = false;

    if (status !== undefined) {
      const current = await this.repo.get(id);
      if (!current) throw new NotFoundError("Pedido não encontrado");
      currentOrder = current.order;
      const currentWorkflow =
        (current.order as any).workflowStatus || OrderStatus.CREATED;

      if (status === "CONFIRMED") {
        const target = legacyStatusFor(currentWorkflow, current.order.status);
        if (currentWorkflow === OrderStatus.CUSTOMER_CONFIRMED || currentWorkflow === OrderStatus.PENDING_APPROVAL) {
          const transition = await this.transition(id, OrderStatus.APPROVED, actor);
          currentOrder = transition.order;
          statusChanged = true;
        } else if (target !== "CONFIRMED" || current.order.status !== "CONFIRMED") {
          throw new BadRequestError("O status deve ser alterado pela transição operacional do pedido.");
        }
      } else if (status === "DELIVERED" || status === "CANCELLED") {
        const target = status === "DELIVERED" ? OrderStatus.DELIVERED : OrderStatus.CANCELLED;
        const transition = await this.transition(id, target, actor);
        currentOrder = transition.order;
        statusChanged = true;
      } else if (status === "ACTIVE") {
        if (
          legacyStatusFor(currentWorkflow, current.order.status) !== "ACTIVE" ||
          current.order.status !== "ACTIVE"
        ) {
          throw new BadRequestError("O status deve permanecer sincronizado com a etapa operacional do pedido.");
        }
      } else {
        throw new BadRequestError("Status não permitido nesta atualização. Use a transição operacional correspondente.");
      }
    }

    const supplementalUpdates: Record<string, unknown> = {};
    if (adminNote !== undefined) supplementalUpdates.adminNote = adminNote;
    if (nimbiExpiration !== undefined) {
      supplementalUpdates.nimbiExpiration = nimbiExpiration || null;
    }

    if (Object.keys(supplementalUpdates).length > 0) {
      const updated = await this.repo.update(id, supplementalUpdates);
      if (statusChanged && status) this.sendLegacyStatusEmail(id, status, adminNote);
      return updated;
    }
    if (statusChanged && status) this.sendLegacyStatusEmail(id, status, adminNote);
    if (currentOrder) return currentOrder;
    return this.repo.update(id, {});
  }

  private sendLegacyStatusEmail(id: number, status: string, adminNote?: string) {
    setImmediate(async () => {
      try {
        const detail = await this.repo.get(id);
        if (!detail) return;
        const order = detail.order as any;
        const company = await this.repo.getCompany(order.companyId);
        if (!company) return;
        await sendOrderStatusChanged({
          toEmail: company.email,
          companyName: company.companyName,
          vfCode: order.vfCode || `#${id}`,
          status,
          adminNote,
        });
      } catch (error) {
        console.error("[EMAIL] Erro ao enviar email de status:", error);
      }
    });
  }

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ WORKFLOW TRANSITION                                              ║
  // ╚══════════════════════════════════════════════════════════════════╝

  /**
   * `POST /api/orders/:id/transition`
   *
   * Drives the order through the controlled `workflowStatus` state machine.
   *
   * ─── Safety contract (4 phases) ────────────────────────────────────────
   *
   * PHASE 1 — Pre-flight reads (no DB writes yet)
   *   Load order, acting user, and company. Fail fast with 4xx before
   *   opening any transaction slot.
   *
   * PHASE 2 — Validation (pure, synchronous after reads)
   *   a. Auth: actor must be an authenticated staff user.
   *   b. State guard: `assertTransitionAllowed` rejects illegal arcs.
   *   c. RBAC: `assertTransitionRole` rejects under-privileged callers.
   *   d. Business rules: `validateBusinessRules` checks domain invariants
    *      (customer active/not-locked; fiscal documents do not gate
    *       operational shipping).
   *
   * PHASE 3 — Atomic transaction (critical — all-or-nothing)
   *   Calls `executeWorkflowTransaction` which runs inside a single pg BEGIN.
   *   Writes: workflowStatus + legacy status, initial delivery on approval,
   *   delivery status updates and the workflow outbox. Orders do not write
   *   inventory movements or accounts receivable.
   *   Any error causes automatic ROLLBACK — no partial state ever persists.
   *
   * PHASE 4 — Non-critical side effects (fire-and-forget)
   *   Push notification and audit log are best-effort. A transient failure
   *   in these never rolls back the committed business state.
   *
   * ─── Status consistency ─────────────────────────────────────────────────
   *   The legacy `orders.status` column is updated inside the SAME transaction
   *   as `orders.workflow_status` using `legacyStatusFor()` mapping. This
   *   prevents any divergence between the two columns that could confuse
   *   legacy endpoints or existing frontend queries.
   *
   * ─── Risks ──────────────────────────────────────────────────────────────
   *   - The audit log and push notification are outside the transaction.
   *     In the unlikely event of a crash between COMMIT and log write, the
   *     transition will have occurred but without a log entry. Acceptable
   *     trade-off vs. making the log a blocking critical dependency.
   *   - The approval transition ensures its initial delivery under a shared
   *     PostgreSQL advisory lock; later split deliveries remain independent.
   */
  async transition(
    id: number,
    to: OrderStatus,
    actor: ActorContext,
    reason?: string,
    customerConfirmationRelease = false,
  ): Promise<{ order: Order; workflowStatus: OrderStatus; from: string; details: Record<string, unknown> }> {

    // ── Phase 1: Pre-flight reads (no DB writes, no locks yet) ────────────────
    if (!actor.userId) throw new UnauthorizedError();

    const [user, orderData] = await Promise.all([
      this.repo.getUser(actor.userId),
      this.repo.get(id),
    ]);
    if (!user) throw new UnauthorizedError();
    if (!orderData) throw new NotFoundError("Pedido não encontrado");

    const orderRow: any = orderData.order;
    const from: string  = (orderRow.workflowStatus as string) || OrderStatus.CREATED;

    const company = await this.repo.getCompany(orderRow.companyId);

    // ── Phase 2: Validation (pure — all reads are done, no writes yet) ───────
    assertTransitionAllowed(from, to);
    const authorizedCustomerRelease = customerConfirmationRelease &&
      to === OrderStatus.APPROVED &&
      from === OrderStatus.CUSTOMER_CONFIRMED &&
      actor.companyId != null && Number(actor.companyId) === Number(orderRow.companyId) &&
      currentTenantId() != null && Number(currentTenantId()) === Number(orderRow.companyId);
    if (customerConfirmationRelease && !authorizedCustomerRelease) {
      throw new ForbiddenError("Liberação automática não autorizada para este pedido.");
    }
    if (!authorizedCustomerRelease) assertTransitionRole(to, user.role);
    if (to === OrderStatus.CANCELLED) {
      await this.assertOperationalDeadline(id, "cancel", actor, undefined, orderRow);
    }

    // STEP 7.1 — Skip-step guard: APPROVED → INVOICED is allowed by the state
    // machine (legacy fast path), but only privileged roles can use it. Regular
    // operators must follow the operational pipeline:
    //   APPROVED → PROCESSING → READY → INVOICED
    if (from === OrderStatus.APPROVED && to === OrderStatus.INVOICED) {
      const isPrivileged = user.role === "MASTER" || user.role === "DIRECTOR";
      if (!isPrivileged) {
        throw new BadRequestError(
          "Fluxo operacional obrigatório: iniciar separação primeiro.",
        );
      }
    }

    validateBusinessRules({ orderId: id, to, company, orderRow });

    // ── Phase 3: Atomic transaction — ALL critical writes ─────────────────────
    //
    // Delegated entirely to the repository layer so the service never touches
    // ORM code directly. The repository wraps executeWorkflowTransaction()
    // which runs everything inside a single pg BEGIN/COMMIT block.
    const txResult = await this.repo.executeTransition({
      orderId:                id,
      to,
      from,                                   // for outbox payload
      expectedWorkflowStatus: from,           // optimistic-lock token
      currentLegacyStatus:    orderRow.status,
      orderSnapshot:          orderRow,
      companySnapshot:        company,
      actor: {
        id:    user.id,
        email: user.email,
        role:  user.role,
        name:  (user as any).name,
      },
    });

    // ── Phase 4: Side effects handled by outbox worker ─────────────────────
    //
    // Push notification and audit log are written atomically to workflow_events
    // inside the transaction above. The outbox worker (orders.outbox.worker.ts)
    // picks them up asynchronously and retries on failure — no fire-and-forget.

    const details: Record<string, unknown> = {};
    if (txResult.preNotaNumber)          details.preNotaNumber          = txResult.preNotaNumber;
    if (txResult.deliveryCreated)         details.deliveryCreated         = true;
    if (txResult.deliveryUpdated)        details.deliveryUpdated        = true;

    return {
      order:          txResult.updatedOrder as unknown as Order,
      workflowStatus: to,
      from,
      details,
    };
  }

  /** Retry durable customer confirmations from the internal outbox worker. */
  async retryPendingCustomerConfirmations(
    limit = 25,
  ): Promise<{ scanned: number; released: number; skipped: number; failed: number }> {
    return retryCustomerConfirmations({
      list: (batchLimit) => this.repo.listCustomerConfirmedForRetry(batchLimit),
      getCompany: (companyId) => this.repo.getCompany(companyId),
      release: async (orderRow, company) => {
        const from = OrderStatus.CUSTOMER_CONFIRMED;
        assertTransitionAllowed(from, OrderStatus.APPROVED);
        validateBusinessRules({
          orderId: orderRow.id,
          to: OrderStatus.APPROVED,
          company,
          orderRow,
        });

        // This trusted internal continuation is only reached for a persisted
        // CUSTOMER_CONFIRMED row. The transaction still rechecks state under
        // the distributed lock and applies the normal business validations.
        await this.repo.executeTransition({
          orderId: orderRow.id,
          to: OrderStatus.APPROVED,
          from,
          expectedWorkflowStatus: from,
          currentLegacyStatus: orderRow.status,
          orderSnapshot: orderRow,
          companySnapshot: company,
          actor: {
            id: 0,
            email: "system:customer-confirmation-retry",
            role: "SYSTEM",
            name: "Recuperação automática",
          },
        });
      },
      onFailure: (orderId, error: any) => {
        logSecurity(
          `[ORDER_CONFIRMATION_RETRY_FAILED] orderId=${orderId} | code=${error?.code ?? "unknown"} | status=${error?.status ?? "unknown"}`,
        );
      },
    }, limit);
  }

  // ║ DELETE                                                           ║
  // ╚══════════════════════════════════════════════════════════════════╝

  /**
   * `DELETE /api/orders/:id` — admin/director/developer only. If the order
   * has fiscal status `nota_emitida`/`nota_exportada` and the caller did not
   * pass `confirmar: true`, throws a `ConflictError` carrying the legacy
   * confirmation envelope under `details`.
   */
  async remove(
    id: number,
    body: { motivo?: string; confirmar?: boolean },
    actor: ActorContext,
  ): Promise<{ success: true }> {
    const user = await this.requireRole(actor, DELETE_ROLES, "Sem permissão para excluir pedidos");
    const data = await this.repo.get(id);
    if (!data) {
      console.warn(
        `[SECURITY] WRITE_BLOCKED | requestId=${getRequestIdForLog()} | orderId=${id} | details=write blocked tenant=${currentTenantId() ?? "unknown"} orderCompanyId=unknown`,
      );
      throw new NotFoundError("Pedido não encontrado");
    }
    // FASE NF.7.9.2 — guard de fechamento mensal. Aproveita o `data` já
    // lido (evita SELECT extra). Se o pedido foi criado em mês fechado
    // para a empresa, recusa com 403 e log [SECURITY] PERIODO_FECHADO.
    await this.assertPeriodOpenForOrder(data.order as any, "remove");
    const isFiscal = ["nota_emitida", "nota_exportada"].includes(
      (data.order as any).fiscalStatus || "",
    );
    if (isFiscal && !body.confirmar) {
      throw new ConflictError("Confirmação necessária", {
        requiresConfirmation: true,
        orderCode: (data.order as any).orderCode || String(id),
      });
    }
    auditLog("DELETE_ORDER", {
      userId: user.id,
      role: user.role,
      entity: "order",
      entityId: id,
      details: { orderCode: (data.order as any).orderCode, motivo: body.motivo || "Não informado" },
    });
    await this.repo.createLog({
      action: "ORDER_DELETED",
      description: `Pedido #${(data.order as any).orderCode || id} excluído por ${user.name} (${user.role}). Motivo: ${body.motivo || "Não informado"}`,
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      level: "WARN",
    });
    await this.repo.remove(id);
    return { success: true };
  }

  /**
   * `DELETE /api/orders/bulk` — bulk delete with the same fiscal-confirm
   * gate as single delete. Returns `{ success, deleted }` to mirror legacy.
   */
  async bulkDelete(
    body: { orderIds: any[]; motivo?: string; confirmar?: boolean },
    actor: ActorContext,
  ): Promise<{ success: true; deleted: number }> {
    const user = await this.requireRole(actor, DELETE_ROLES, "Sem permissão para excluir pedidos");
    const ids = [...new Set((body.orderIds || []).map((x) => Number(x)))];
    if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new BadRequestError("Informe pedidos válidos para exclusão");
    }
    // Cross-tenant admins must explicitly select a target using
    // ?empresaId=N. The repository's write guard enforces the same rule.
    const tenantId = requireTenantId();

    const orderResults = await Promise.all(ids.map((i) => this.repo.get(i)));
    if (orderResults.some((result) => !result)) {
      throw new NotFoundError("Um ou mais pedidos não foram encontrados");
    }
    if (orderResults.some((result) => Number((result!.order as any).companyId) !== tenantId)) {
      throw new ForbiddenError("Todos os pedidos devem pertencer ao tenant selecionado");
    }
    // Validate the entire batch before deleting any row. This also prevents
    // partial deletion when a fiscal period is closed for one of the orders.
    for (const result of orderResults) {
      await this.assertPeriodOpenForOrder(result!.order as any, "remove");
    }
    const fiscalOrders = orderResults.filter(
      (r) =>
        r &&
        ["nota_emitida", "nota_exportada"].includes(
          (r.order as any).fiscalStatus || "",
        ),
    );
    if (fiscalOrders.length > 0 && !body.confirmar) {
      throw new ConflictError("Confirmação necessária", {
        requiresConfirmation: true,
        billedCount: fiscalOrders.length,
        billedCodes: fiscalOrders.map(
          (r) => (r!.order as any).orderCode || String((r!.order as any).id),
        ),
      });
    }
    auditLog("BULK_DELETE_ORDERS", {
      userId: user.id,
      role: user.role,
      entity: "order",
      details: { orderIds: ids, count: ids.length, motivo: body.motivo || "Não informado" },
    });
    await this.repo.createLog({
      action: "BULK_ORDER_DELETE",
      description: `${ids.length} pedido(s) excluído(s) em lote por ${user.name} (${user.role}). Motivo: ${body.motivo || "Não informado"}`,
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      level: "WARN",
    });
    for (const id of ids) await this.repo.remove(id);
    return { success: true, deleted: ids.length };
  }

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ REOPEN WORKFLOW                                                  ║
  // ╚══════════════════════════════════════════════════════════════════╝

  async requestReopen(
    id: number,
    reason: string,
    actor: ActorContext,
  ): Promise<Order> {
    if (!actor.companyId) throw new UnauthorizedError();
    const data = await this.repo.get(id);
    if (!data) throw new NotFoundError("Pedido não encontrado");
    if ((data.order as any).companyId !== actor.companyId)
      throw new ForbiddenError("Sem permissão");
    if (!["CONFIRMED", "ACTIVE"].includes((data.order as any).status)) {
      throw new BadRequestError("Pedido não pode ser reaberto neste status.");
    }
    // Operational guard: once the order has entered the logistics pipeline
    // (PROCESSING / READY / INVOICED / SHIPPED / DELIVERED) the client can no
    // longer request edits — separation has started in the warehouse.
    const wfBlocked = new Set([
      "PROCESSING",
      "READY",
      "INVOICED",
      "SHIPPED",
      "DELIVERED",
    ]);
    const wf = (data.order as any).workflowStatus as string | undefined;
    if (wf && wfBlocked.has(wf)) {
      throw new BadRequestError(
        "Pedido já entrou em separação e não pode mais ser editado.",
      );
    }
    // Prazo operacional: bloqueia solicitação de alteração após 12:00 BRT
    // do penúltimo dia útil antes da entrega.
    await this.assertOperationalDeadline(
      id,
      "request-change",
      actor,
      undefined,
      data.order as any,
    );

    // FASE NF.7.9.10 — bloqueio de reabertura em mês fechado.
    // Reaproveita assertPeriodOpen (mesmo helper de update/remove/replace-items).
    // Em mês fechado: log [SECURITY] PERIODO_FECHADO + 403 ForbiddenError.
    await this.assertPeriodOpen(id, "reopen-request");
    const updated = await this.repo.update(id, {
      status: "REOPEN_REQUESTED",
      reopenReason: String(reason).trim(),
      reopenRequestedAt: new Date(),
    });
    await this.repo.createLog({
      action: "ORDER_REOPEN_REQUESTED",
      description: `Pedido ${(data.order as any).orderCode} — solicitação de alteração: ${reason}`,
      companyId: actor.companyId,
      userRole: "CLIENT",
      level: "INFO",
    });
    return updated;
  }

  async approveReopen(id: number, actor: ActorContext): Promise<Order> {
    const user = await this.requireRole(actor, REOPEN_ADMIN_ROLES, "Sem permissão");
    const data = await this.repo.get(id);
    if (!data) throw new NotFoundError("Pedido não encontrado");
    if ((data.order as any).status !== "REOPEN_REQUESTED") {
      throw new BadRequestError(
        "Pedido não está em solicitação de alteração.",
      );
    }
    await this.assertOperationalDeadline(
      id,
      "reopen-approve",
      actor,
      REOPENED_ORDER_EXPIRED_MESSAGE,
      data.order as any,
    );
    // FASE NF.7.9.10 — bloqueio de aprovação de reabertura em mês fechado.
    // Mesma proteção de update/remove/replace-items: 403 PERIODO_FECHADO.
    await this.assertPeriodOpen(id, "reopen-approve");
    const updated = await this.repo.update(id, { status: "OPEN_FOR_EDITING" });
    await this.repo.createLog({
      action: "ORDER_REOPEN_APPROVED",
      description: `Pedido ${(data.order as any).orderCode} aprovado para edição por ${user.email}`,
      userRole: user.role,
      level: "INFO",
    });
    return updated;
  }

  async denyReopen(id: number, actor: ActorContext): Promise<Order> {
    const user = await this.requireRole(actor, REOPEN_ADMIN_ROLES, "Sem permissão");
    const data = await this.repo.get(id);
    if (!data) throw new NotFoundError("Pedido não encontrado");
    if ((data.order as any).status !== "REOPEN_REQUESTED") {
      throw new BadRequestError(
        "Pedido não está em solicitação de alteração.",
      );
    }
    // FASE NF.7.9.10 — bloqueio de negação de reabertura em mês fechado.
    // Mesma proteção de update/remove/replace-items: 403 PERIODO_FECHADO.
    await this.assertPeriodOpen(id, "reopen-deny");
    const updated = await this.repo.update(id, {
      status: "CONFIRMED",
      reopenReason: null,
      reopenRequestedAt: null,
    });
    await this.repo.createLog({
      action: "ORDER_REOPEN_DENIED",
      description: `Pedido ${(data.order as any).orderCode} negado por ${user.email}`,
      userRole: user.role,
      level: "INFO",
    });
    return updated;
  }

  /**
   * STEP 7.2 — Order timeline. Returns the audit log for a single order in
   * chronological order. Reuses the existing `system_logs` table (no new
   * tables, no schema changes). Logs are matched via `description ILIKE
   * '%orderCode%'` since every order-related log embeds the orderCode.
   *
   * Tenancy: clients only see logs for orders belonging to their company.
   * Internal staff (any non-CLIENT role) can see all order timelines.
   */
  async getOrderTimeline(id: number, actor: ActorContext) {
    if (!actor.userId) throw new UnauthorizedError();
    const data = await this.repo.get(id);
    if (!data) throw new NotFoundError("Pedido não encontrado");

    const orderRow: any = data.order;

    // Tenant guard: clients can only see their own company's orders.
    // Staff roles (handled via actor.companyId being absent OR explicit role)
    // bypass the company check.
    if (actor.companyId && orderRow.companyId !== actor.companyId) {
      throw new ForbiddenError("Sem permissão");
    }

    const orderCode = orderRow.orderCode || `#${orderRow.id}`;
    const logs = await this.repo.getLogsByOrderCode(orderCode);

    // Strip sensitive fields (ip, userEmail) for client consumption while
    // keeping the action / description / userRole / timestamp visible.
    return logs.map((log: any) => ({
      id:          log.id,
      action:      log.action,
      description: log.description,
      userRole:    log.userRole,
      level:       log.level,
      createdAt:   log.createdAt,
    }));
  }

  async finalizeEdit(
    id: number,
    items: any[] | undefined,
    actor: ActorContext,
  ): Promise<Order> {
    if (!actor.companyId) throw new UnauthorizedError();
    const data = await this.repo.get(id);
    if (!data) throw new NotFoundError("Pedido não encontrado");
    if ((data.order as any).companyId !== actor.companyId)
      throw new ForbiddenError("Sem permissão");
    if ((data.order as any).status !== "OPEN_FOR_EDITING") {
      throw new BadRequestError("Pedido não está em modo de edição.");
    }
    // Prazo operacional: mesmo que o pedido tenha sido reaberto pelo admin,
    // bloqueia edição se o prazo operacional já expirou.
    await this.assertOperationalDeadline(
      id,
      "finalize-edit",
      actor,
      REOPENED_ORDER_EXPIRED_MESSAGE,
      data.order as any,
    );

    const candidateItems =
      Array.isArray(items) && items.length > 0 ? items : data.items;
    await this.assertMinimumWeeklyBilling({
      companyId: Number((data.order as any).companyId),
      weekReference: (data.order as any).weekReference,
      candidateItems,
      replacingOrderId: id,
    });

    if (Array.isArray(items) && items.length > 0) {
      await this.repo.updateItems(id, items as any);
    }
    const updated = await this.repo.update(id, {
      status: "CONFIRMED",
      reopenReason: null,
      reopenRequestedAt: null,
    });
    await this.repo.createLog({
      action: "ORDER_EDIT_FINALIZED",
      description: `Pedido ${(data.order as any).orderCode} re-finalizado pelo cliente`,
      companyId: actor.companyId,
      userRole: "CLIENT",
      level: "INFO",
    });
    return updated;
  }

  /**
   * Shared backend guard for all customer-facing confirmation paths.
   * It runs before any order write and uses the tenant-scoped repository for
   * persisted weekly totals.
   */
  private async assertMinimumWeeklyBilling(input: {
    companyId: number;
    weekReference?: string | null;
    candidateItems: any[];
    existingOrders?: WeeklyBillingOrder[];
    replacingOrderId?: number;
  }): Promise<void> {
    if (!Number.isFinite(input.companyId) || input.companyId <= 0) return;

    const company = await this.repo.getCompany(input.companyId);
    const minimum = parseFloat(String((company as any)?.minWeeklyBilling ?? "0")) || 0;
    if (minimum <= 0) return;

    const existingOrders =
      input.existingOrders ?? (await this.repo.listByCompanyId(input.companyId));
    const total = calculateWeeklyBillingTotal({
      companyId: input.companyId,
      weekReference: input.weekReference,
      existingOrders,
      candidateItems: input.candidateItems,
      replacingOrderId: input.replacingOrderId,
    });

    if (total < minimum) {
      throw new BadRequestError(minimumWeeklyBillingMessage(minimum, total));
    }
  }

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ ITEMS                                                            ║
  // ╚══════════════════════════════════════════════════════════════════╝

  async replaceItems(id: number, items: any[], actor?: ActorContext): Promise<OrderDetail> {
    if (!Array.isArray(items)) throw new BadRequestError("items required");

    await this.assertOperationalDeadline(
      id,
      "replace-items",
      actor ?? {},
    );

    // 🔒 FASE 6.1 — BLOQUEIO DE PERÍODO FECHADO (replace-items).
    // Mesmo padrão de update() (linha 718) e remove() (linha 1032). Se o
    // pedido pertence a um mês já consolidado em fiscal_closures para a
    // empresa, recusa com 403 ForbiddenError("PERIODO_FECHADO") e log
    // [SECURITY] PERIODO_FECHADO (emitido dentro do helper — não duplicar).
    // Fail-open quando id não existe / sem companyId / sem createdAt
    // (assertPeriodOpenForOrder retorna sem efeito), preservando 100% o
    // comportamento atual fora do mês fechado.
    await this.assertPeriodOpen(id, "replace-items");

    // ── Read-only divergence observation (no behavior change) ──
    // We need companyId to fetch the admin-fee markup; the order detail is
    // ALREADY fetched right after the write below — we simply read it once
    // upfront for the observer. The actual write/read order is preserved
    // (updateItems → get → return), so no contract changes.
    let observedMarkup: number | null = null;
    let observedCompanyId: number | null = null;
    try {
      const detail = await this.repo.get(id);
      observedCompanyId = (detail?.order as any)?.companyId ?? null;
      if (observedCompanyId != null) {
        const company: any = await this.repo.getCompany(observedCompanyId);
        if (company && company.adminFee != null && company.adminFee !== "") {
          const m = Number(company.adminFee);
          observedMarkup = Number.isFinite(m) ? m : null;
        }
      }
      for (const it of items as any[]) {
        const legacy = Number(it.unitPrice);
        if (!Number.isFinite(legacy)) continue;
        const resolved = resolveProductPrice({
          basePrice: legacy,
          subCategoryPrice: null,
          priceGroupMarkup: observedMarkup,
          contractPrice: null,
        });
        logPriceDivergence(
          {
            scope: "orders.service",
            method: "replaceItems",
            productId: it.productId,
            companyId: observedCompanyId,
          },
          legacy,
          resolved,
          { quantity: it.quantity, orderId: id },
        );
      }
    } catch (e) {
      console.warn("[priceResolver] observer error (replaceItems)", e);
    }

    // Reuse the company already loaded for the observer above. An active
    // administrative fee always triggers server-side repricing.
    try {
      if (observedCompanyId != null) {
        const company: any = await this.repo.getCompany(observedCompanyId);
        const configuredFee = Number(company?.adminFee ?? 0);
        observedMarkup = Number.isFinite(configuredFee) ? configuredFee : null;
        if (shouldResolveCompanyPricing(company)) {
          const adminFee =
            company.adminFee != null && company.adminFee !== ""
              ? Number(company.adminFee)
              : 0;
          const productCache = new Map<number, any>();
          // STEP 4 — per-call cache of subCategory rows.
          const subCategoryCache = new Map<number, any>();
          // STEP 5 — per-call cache of contractScope rows.
          const contractCache = new Map<string, any>();
          for (const it of items as any[]) {
            let product = productCache.get(it.productId);
            if (!product) {
              product = await this.repo.getProductById(it.productId);
              if (product) productCache.set(it.productId, product);
            }
            if (!product) {
              if (Number.isFinite(configuredFee) && configuredFee > 0) {
                throw new BadRequestError("Não foi possível validar um produto para aplicar a taxa administrativa.");
              }
              continue;
            }
            // STEP 4 — resolve subCategoryPrice (optional, with fallback).
            let subCategoryPrice: number | null = null;
            if (it.subCategoryId != null) {
              try {
                let sub = subCategoryCache.get(Number(it.subCategoryId));
                if (sub === undefined) {
                  sub = await this.repo.getProductSubCategoryById(
                    Number(it.subCategoryId),
                  );
                  subCategoryCache.set(Number(it.subCategoryId), sub);
                }
                const raw = sub?.price;
                if (raw != null) {
                  const n = Number(raw);
                  if (Number.isFinite(n)) subCategoryPrice = n;
                }
              } catch (subErr) {
                console.warn("[pricing] subCategory lookup failed — fallback basePrice", {
                  method: "replaceItems",
                  productId: it.productId,
                  subCategoryId: it.subCategoryId,
                  orderId: id,
                  err: (subErr as Error)?.message,
                });
                subCategoryPrice = null;
              }
            }
            // STEP 5 — resolve contractPrice (optional, highest priority).
            let contractPrice: number | null = null;
            try {
              const cacheKey = `${observedCompanyId}-${it.productId}`;
              let scope = contractCache.get(cacheKey);
              if (scope === undefined) {
                scope = await this.repo.getContractScope(
                  observedCompanyId as number,
                  it.productId,
                );
                contractCache.set(cacheKey, scope);
              }
              const rawCP = scope?.unitPrice;
              if (rawCP != null) {
                const n = Number(rawCP);
                if (Number.isFinite(n)) contractPrice = n;
              }
            } catch (cErr) {
              console.warn("[pricing] contract lookup failed — fallback subCategory/base", {
                method: "replaceItems",
                companyId: observedCompanyId,
                productId: it.productId,
                orderId: id,
                err: (cErr as Error)?.message,
              });
              contractPrice = null;
            }
            const newUnit = resolveProductPrice({
              basePrice: Number(product.basePrice),
              subCategoryPrice,
              contractPrice,
              adminFee,
            });
            if (!Number.isFinite(newUnit)) continue;
            it.unitPrice = String(newUnit.toFixed(2));
            it.totalPrice = String(
              (newUnit * Number(it.quantity || 0)).toFixed(2),
            );
            console.info("[pricing] category pricing applied", {
              scope: "orders.service",
              method: "replaceItems",
              productId: it.productId,
              subCategoryId: it.subCategoryId ?? null,
              usedSubCategory: subCategoryPrice !== null,
            });
            console.info("[pricing] contract pricing applied", {
              scope: "orders.service",
              method: "replaceItems",
              companyId: observedCompanyId,
              productId: it.productId,
              usedContract: contractPrice !== null,
            });
          }
          console.info("[pricing] new pricing ENABLED", {
            scope: "orders.service",
            method: "replaceItems",
            companyId: observedCompanyId,
            orderId: id,
          });
        }
      }
    } catch (e) {
      console.error(
        "[pricing] company pricing recalculation failed",
        { method: "replaceItems", orderId: id, err: (e as Error)?.message },
      );
      if (observedMarkup != null && observedMarkup > 0) {
        throw new BadRequestError("Não foi possível atualizar os preços com a taxa administrativa. Tente novamente.");
      }
    }

    await this.repo.updateItems(id, items as any);
    const result = await this.repo.get(id);
    if (!result) throw new NotFoundError("Pedido não encontrado");
    try {
      const orderRow: any = result.order;
      const orderCode = orderRow?.orderCode || `#${id}`;
      await this.repo.createLog({
        action: "ORDER_ITEMS_REPLACED",
        description: `Itens atualizados: ${orderCode} (${items.length} item${items.length === 1 ? "" : "s"})`,
        companyId: orderRow?.companyId,
        userId: actor?.userId,
        userEmail: (actor as any)?.email,
        userRole: (actor as any)?.role || (actor?.companyId ? "CLIENT" : null),
        level: "INFO",
      });
    } catch {
      /* swallow per legacy */
    }
    return result;
  }

  /**
   * `POST /api/orders/:id/substitute-item` — safra substitution flow.
   * Returns `{ ok: true, note? }` to match the legacy payload exactly.
   */
  async substituteItem(
    orderId: number,
    body: {
      action: "remove" | "replace" | "discount" | "note";
      itemId: number;
      newProductId?: number;
      discountPct?: number;
      nfNote?: string;
    },
    actor: ActorContext,
  ): Promise<{ ok: true; note?: string }> {
    const { action, itemId, newProductId, discountPct, nfNote } = body;
    if (!orderId || !itemId || !action)
      throw new BadRequestError("Dados inválidos");

    const detail = await this.repo.get(orderId);
    if (!detail) throw new NotFoundError("Pedido não encontrado");

    const items = detail.items as any[];
    const targetIdx = items.findIndex((i) => i.id === itemId);
    if (targetIdx === -1) throw new NotFoundError("Item não encontrado");
    const target = items[targetIdx];

    const newItems = [...items];
    let description = "";

    if (action === "remove") {
      newItems.splice(targetIdx, 1);
      description = `Item removido do pedido ${(detail.order as any).orderCode} (safra encerrada)`;
    } else if (action === "replace" && newProductId) {
      const newProduct = (await this.repo.getProductById(newProductId)) as any;
      if (!newProduct)
        throw new NotFoundError("Produto substituto não encontrado");
      newItems[targetIdx] = {
        ...target,
        productId: newProductId,
        unitPrice: newProduct.basePrice || target.unitPrice,
      };
      newItems[targetIdx].totalPrice = String(
        Number(newItems[targetIdx].unitPrice) * Number(target.quantity),
      );
      description = `Produto substituído no pedido ${(detail.order as any).orderCode} (safra encerrada)`;

      // ── Read-only divergence observation (no behavior change) ──
      // newProduct is already fetched above. We additionally read the
      // company's adminFee for the markup observation; failures are
      // swallowed so this NEVER affects the substitution flow.
      try {
        const companyId = (detail.order as any)?.companyId ?? null;
        let markup: number | null = null;
        if (companyId != null) {
          const company: any = await this.repo.getCompany(companyId);
          if (company && company.adminFee != null && company.adminFee !== "") {
            const m = Number(company.adminFee);
            markup = Number.isFinite(m) ? m : null;
          }
        }
        const legacy = Number(newItems[targetIdx].unitPrice);
        const baseFromProduct = Number(newProduct.basePrice);
        const resolved = resolveProductPrice({
          basePrice: Number.isFinite(baseFromProduct) ? baseFromProduct : legacy,
          subCategoryPrice: null,
          priceGroupMarkup: markup,
          contractPrice: null,
        });
        logPriceDivergence(
          {
            scope: "orders.service",
            method: "substituteItem.replace",
            productId: newProductId,
            companyId,
          },
          legacy,
          resolved,
          { quantity: target.quantity, orderId, itemId },
        );
      } catch (e) {
        console.warn("[priceResolver] observer error (substituteItem.replace)", e);
      }

      // Apply company-specific pricing when the fee is configured, even if
      // the legacy rollout flag is off.
      try {
        const cId = (detail.order as any)?.companyId ?? null;
        if (cId != null) {
          const company: any = await this.repo.getCompany(cId);
          if (shouldResolveCompanyPricing(company)) {
            const adminFee =
              company.adminFee != null && company.adminFee !== ""
                ? Number(company.adminFee)
                : 0;
            // STEP 4 — resolve subCategoryPrice (optional, with fallback).
            // The replaced item carries the subCategoryId from the original
            // line; if the user picked a substitute that is bound to a
            // different sub-category, the upstream flow updates `target`
            // accordingly. Cache is local because this is a single item.
            let subCategoryPrice: number | null = null;
            const subId = (newItems[targetIdx] as any)?.subCategoryId
              ?? (target as any)?.subCategoryId;
            if (subId != null) {
              try {
                const sub = await this.repo.getProductSubCategoryById(
                  Number(subId),
                );
                const raw = sub?.price;
                if (raw != null) {
                  const n = Number(raw);
                  if (Number.isFinite(n)) subCategoryPrice = n;
                }
              } catch (subErr) {
                console.warn("[pricing] subCategory lookup failed — fallback basePrice", {
                  method: "substituteItem.replace",
                  productId: newProductId,
                  subCategoryId: subId,
                  orderId,
                  itemId,
                  err: (subErr as Error)?.message,
                });
                subCategoryPrice = null;
              }
            }
            // STEP 5 — resolve contractPrice for the substitute product.
            // Single-row lookup (one item path); no per-call cache needed.
            let contractPrice: number | null = null;
            try {
              const scope = await this.repo.getContractScope(cId, newProductId);
              const rawCP = scope?.unitPrice;
              if (rawCP != null) {
                const n = Number(rawCP);
                if (Number.isFinite(n)) contractPrice = n;
              }
            } catch (cErr) {
              console.warn("[pricing] contract lookup failed — fallback subCategory/base", {
                method: "substituteItem.replace",
                companyId: cId,
                productId: newProductId,
                orderId,
                itemId,
                err: (cErr as Error)?.message,
              });
              contractPrice = null;
            }
            const newUnit = resolveProductPrice({
              basePrice: Number(newProduct.basePrice),
              subCategoryPrice,
              contractPrice,
              adminFee,
            });
            if (Number.isFinite(newUnit)) {
              newItems[targetIdx].unitPrice = String(newUnit.toFixed(2));
              newItems[targetIdx].totalPrice = String(
                (newUnit * Number(target.quantity || 0)).toFixed(2),
              );
              console.info("[pricing] category pricing applied", {
                scope: "orders.service",
                method: "substituteItem.replace",
                productId: newProductId,
                subCategoryId: subId ?? null,
                usedSubCategory: subCategoryPrice !== null,
              });
              console.info("[pricing] contract pricing applied", {
                scope: "orders.service",
                method: "substituteItem.replace",
                companyId: cId,
                productId: newProductId,
                usedContract: contractPrice !== null,
              });
              console.info("[pricing] new pricing ENABLED", {
                scope: "orders.service",
                method: "substituteItem.replace",
                companyId: cId,
                orderId,
                itemId,
              });
            }
          }
        }
      } catch (e) {
        console.error(
          "[pricing] company pricing recalculation failed",
          {
            method: "substituteItem.replace",
            orderId,
            itemId,
            err: (e as Error)?.message,
          },
        );
        const cId = (detail.order as any)?.companyId ?? null;
        if (cId != null) {
          const company: any = await this.repo.getCompany(cId);
          const fee = Number(company?.adminFee ?? 0);
          if (Number.isFinite(fee) && fee > 0) {
            throw new BadRequestError("Não foi possível atualizar os preços com a taxa administrativa. Tente novamente.");
          }
        }
      }
    } else if (action === "discount" && discountPct !== undefined) {
      const pct = Number(discountPct);
      const newUnit = Number(target.unitPrice) * (1 - pct / 100);
      newItems[targetIdx] = {
        ...target,
        unitPrice: String(newUnit.toFixed(2)),
        totalPrice: String((newUnit * Number(target.quantity)).toFixed(2)),
      };
      description = `Desconto de ${pct}% aplicado no pedido ${(detail.order as any).orderCode} (safra encerrada)`;
    } else if (action === "note") {
      description = `Obs. NF adicionada no pedido ${(detail.order as any).orderCode}: "${nfNote}"`;
    } else {
      throw new BadRequestError("Ação inválida");
    }

    const newTotal = newItems.reduce(
      (sum: number, i: any) => sum + Number(i.totalPrice),
      0,
    );
    await this.repo.update(orderId, {
      totalValue: String(newTotal.toFixed(2)),
    });
    if (action !== "note") {
      await this.repo.updateItems(
        orderId,
        newItems.map((i: any) => ({
          productId: i.productId,
          quantity: Number(i.quantity),
          unitPrice: String(i.unitPrice),
          totalPrice: String(i.totalPrice),
        })),
      );
    }

    const actingUser = actor.userId
      ? await this.repo.getUser(actor.userId)
      : null;
    await this.repo.createLog({
      action: "SAFRA_SUBSTITUTION",
      description: `${description}. Operador: ${actingUser?.name || "Sistema"}`,
      userEmail: actingUser?.email || "sistema",
      level: "INFO",
      ip: actor.ip || "",
    });

    return action === "note" ? { ok: true, note: nfNote } : { ok: true };
  }

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ FISCAL / ERP / DANFE                                             ║
  // ╚══════════════════════════════════════════════════════════════════╝

  async listDanfeLogs(orderId: number, actor: ActorContext) {
    await this.requireRole(actor, DANFE_ROLES, "Sem permissão");
    return this.repo.getDanfeRecordsByOrderId(orderId);
  }

  async createDanfeLog(
    orderId: number,
    body: { orderCode?: string | null },
    actor: ActorContext,
  ) {
    const user = await this.requireRole(actor, DANFE_ROLES, "Sem permissão");
    return this.repo.createDanfeRecord({
      orderId,
      orderCode: body.orderCode ?? null,
      generatedByUserId: user.id,
      generatedByEmail: user.email,
    });
  }

  async updateFiscal(
    id: number,
    body: { fiscalStatus?: string; preNotaNumber?: string | null },
    actor: ActorContext,
  ): Promise<Order> {
    const user = await this.requireRole(actor, FISCAL_ROLES, "Sem permissão");
    const updates: any = {};
    if (body.fiscalStatus) updates.fiscalStatus = body.fiscalStatus;
    if (body.preNotaNumber !== undefined)
      updates.preNotaNumber = body.preNotaNumber;
    const updated = await this.repo.update(id, updates);
    try {
      const orderCode = (updated as any)?.orderCode || `#${id}`;
      const parts: string[] = [];
      if (body.fiscalStatus) parts.push(`status=${body.fiscalStatus}`);
      if (body.preNotaNumber !== undefined)
        parts.push(`preNota=${body.preNotaNumber ?? "null"}`);
      await this.repo.createLog({
        action: "ORDER_FISCAL_UPDATED",
        description: `Fiscal atualizado: ${orderCode}${parts.length ? ` (${parts.join(", ")})` : ""}`,
        companyId: (updated as any)?.companyId,
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        level: "INFO",
      });
    } catch {
      /* swallow per legacy */
    }
    return updated;
  }

  async generatePrenota(
    id: number,
    actor: ActorContext,
  ): Promise<{ preNotaNumber: string; order?: Order }> {
    await this.requireRole(actor, FISCAL_ROLES, "Sem permissão");
    const orderData = await this.repo.get(id);
    if (!orderData) throw new NotFoundError("Pedido não encontrado");
    const existing = (orderData.order as any).preNotaNumber;
    if (existing) return { preNotaNumber: existing };
    const preNotaNumber = `VF-NF-${id.toString().padStart(6, "0")}`;
    const updated = await this.repo.update(id, { preNotaNumber } as any);
    return { preNotaNumber, order: updated };
  }

  async blingExport(
    id: number,
    actor: ActorContext,
  ): Promise<{ success: true; erpId: string; order: Order; exportPayload: any }> {
    const user = await this.requireRole(actor, FISCAL_ROLES, "Sem permissão");
    const orderData = await this.repo.get(id);
    if (!orderData) throw new NotFoundError("Pedido não encontrado");
    const o: any = orderData.order;
    if (o.erpExportStatus === "exportado") {
      throw new ConflictError(
        "Este pedido já foi exportado para o ERP Bling.",
      );
    }
    await this.repo.update(id, { erpExportStatus: "exportando" });
    try {
      const company = await this.repo.getCompany(o.companyId);
      const allProducts = await this.repo.getProducts();
      const productMap = new Map(allProducts.map((p: any) => [p.id, p]));
      const config: any = await this.repo.getCompanyConfig();
      const fmtDate = (d: any) => {
        try {
          return new Date(d).toISOString().split("T")[0];
        } catch {
          return "";
        }
      };
      const items = (orderData.items as any[]).map((item) => {
        const prod: any = productMap.get(item.productId);
        return {
          produto: prod?.name || `Produto #${item.productId}`,
          ncm: prod?.ncm || "",
          cfop: prod?.cfop || config?.defaultCfop || "5102",
          quantidade: item.quantity,
          unidade: prod?.commercialUnit || prod?.unit || "UN",
          valor_unitario: parseFloat(item.unitPrice || "0"),
          valor_total: parseFloat(item.totalPrice || "0"),
        };
      });
      const exportPayload = {
        numero_pedido: o.orderCode || `VF-${id}`,
        data_pedido: fmtDate(o.orderDate),
        data_entrega: fmtDate(o.deliveryDate),
        cliente_nome: company?.companyName || "",
        cliente_cnpj: company?.cnpj || "",
        valor_total_nota: parseFloat(o.totalValue || "0"),
        itens: items,
      };
      const generatedErpId = `BLING-${new Date().getFullYear()}-${id
        .toString()
        .padStart(6, "0")}-${Date.now().toString().slice(-4)}`;
      const updated = await this.repo.update(id, {
        erpExportStatus: "exportado",
        erpExportedAt: new Date(),
        erpId: generatedErpId,
        erpExportError: null,
      });
      await this.repo.createLog({
        action: "ERP_BLING_EXPORT",
        description: `Pedido ${o.orderCode} exportado para Bling. ID: ${generatedErpId}`,
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        level: "INFO",
      });
      return { success: true, erpId: generatedErpId, order: updated, exportPayload };
    } catch (exportErr: any) {
      await this.repo.update(id, {
        erpExportStatus: "erro",
        erpExportError: exportErr.message || "Erro desconhecido",
      });
      throw new AppError(
        `Erro na exportação: ${exportErr.message}`,
        500,
        "EXPORT_ERROR",
      );
    }
  }

  async exportErp(id: number, actor: ActorContext): Promise<any> {
    await this.requireRole(actor, FISCAL_ROLES, "Sem permissão");
    const orderData = await this.repo.get(id);
    if (!orderData) throw new NotFoundError("Pedido não encontrado");
    const o: any = orderData.order;
    const company: any = await this.repo.getCompany(o.companyId);
    const allProducts = await this.repo.getProducts();
    const productMap = new Map(allProducts.map((p: any) => [p.id, p]));
    const config: any = await this.repo.getCompanyConfig();
    const fmtDate = (d: any) => {
      try {
        return new Date(d).toISOString().split("T")[0];
      } catch {
        return "";
      }
    };
    const items = (orderData.items as any[]).map((item) => {
      const prod: any = productMap.get(item.productId);
      return {
        produto: prod?.name || `Produto #${item.productId}`,
        ncm: prod?.ncm || "",
        cfop: prod?.cfop || config?.defaultCfop || "5102",
        quantidade: item.quantity,
        unidade: prod?.commercialUnit || prod?.unit || "UN",
        valor_unitario: parseFloat(item.unitPrice || "0"),
        valor_total: parseFloat(item.totalPrice || "0"),
      };
    });
    return {
      numero_pedido: o.orderCode || `VF-${id}`,
      numero_pre_nota: o.preNotaNumber || "",
      data_pedido: fmtDate(o.orderDate),
      data_entrega: fmtDate(o.deliveryDate),
      semana_referencia: o.weekReference || "",
      cliente_nome: company?.companyName || "",
      cliente_cnpj: company?.cnpj || "",
      cliente_ie: company?.stateRegistration || "",
      cliente_endereco: [company?.addressStreet, company?.addressNumber]
        .filter(Boolean)
        .join(", "),
      cidade: company?.addressCity || "",
      estado: company?.addressState || "",
      cep: company?.addressZip || "",
      contato: company?.contactName || "",
      natureza_operacao:
        config?.defaultNatureza || "Venda de mercadoria adquirida",
      cfop_geral: config?.defaultCfop || "5102",
      remetente_nome: config?.companyName || "VivaFrutaz",
      remetente_cnpj: config?.cnpj || "",
      remetente_ie: config?.stateRegistration || "",
      remetente_endereco: config?.address || "",
      remetente_cidade: config?.city || "",
      remetente_estado: config?.state || "",
      remetente_cep: config?.cep || "",
      itens: items,
      valor_total_nota: parseFloat(o.totalValue || "0"),
      observacoes: [o.orderNote, o.adminNote].filter(Boolean).join(" | "),
      status_fiscal: o.fiscalStatus || "nota_pendente",
    };
  }

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ Helpers                                                          ║
  // ╚══════════════════════════════════════════════════════════════════╝

  /**
   * Resolve the acting user from the session and assert they hold one of the
   * allowed roles. Throws `UnauthorizedError`/`ForbiddenError` (mapped by
   * the central error handler) so the controller stays exception-only.
   */
  private async requireRole(
    actor: ActorContext,
    allowed: readonly string[],
    forbiddenMsg = "Sem permissão",
  ) {
    if (!actor.userId) throw new UnauthorizedError();
    const user = await this.repo.getUser(actor.userId);
    if (!user || !allowed.includes(user.role)) {
      throw new ForbiddenError(forbiddenMsg);
    }
    return user;
  }

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ FASE NF.7.9.2 — Helpers de fechamento mensal fiscal              ║
  // ╚══════════════════════════════════════════════════════════════════╝
  /**
   * Variante por id — busca o pedido pelo repo e delega à variante por
   * objeto. Usada em update() onde ainda não temos o pedido carregado.
   * Se o pedido não existir, segue normal (NotFoundError será emitido
   * mais à frente pelo repo, mantendo o fluxo de erro preexistente).
   */
  async auditOperationalDeadline(
    orderId: number,
    action: string,
    actor: ActorContext,
  ): Promise<{ deadline: string | null; canModify: boolean; reason: string | null }> {
    if (!actor.userId) throw new UnauthorizedError();
    if (!["edit", "request-change", "request-cancellation", "reopen"].includes(action)) {
      throw new BadRequestError("Ação de auditoria inválida.");
    }
    const data = await this.repo.get(orderId);
    if (!data) throw new NotFoundError("Pedido não encontrado");
    const order = data.order as any;
    if (actor.companyId && Number(order.companyId) !== Number(actor.companyId)) {
      throw new ForbiddenError("Sem permissão");
    }
    if (
      !actor.companyId &&
      !["MASTER", "DIRECTOR"].includes(String(actor.role ?? "").toUpperCase())
    ) {
      throw new ForbiddenError("Sem permissão");
    }
    return this.recordOperationalDeadlineCheck(order, action, actor);
  }

  /**
   * Checks and records the operational cutoff before a mutation. The optional
   * snapshot avoids an extra read in workflows that already loaded the order.
   */
  private async assertOperationalDeadline(
    orderId: number,
    source: string,
    actor: ActorContext,
    expiredMessage?: string,
    orderSnapshot?: Record<string, any>,
  ): Promise<void> {
    const data = orderSnapshot ? null : await this.repo.get(orderId);
    const order = orderSnapshot ?? (data?.order as any);
    if (!order) return; // the caller preserves its existing not-found behavior

    const result = await this.recordOperationalDeadlineCheck(order, source, actor);
    if (!result.canModify) {
      throw new OperationalDeadlineError(
        expiredMessage ?? ORDER_MODIFICATION_EXPIRED_MESSAGE,
        {
          orderId,
          deadline: result.deadline,
          reason: result.reason,
        },
      );
    }
  }

  private async recordOperationalDeadlineCheck(
    order: Record<string, any>,
    source: string,
    actor: ActorContext,
  ): Promise<{ deadline: string | null; canModify: boolean; reason: string | null }> {
    const now = new Date();
    let deadline: Date | null = null;
    let canModify = false;
    let reason: string | null = null;

    if (!order.deliveryDate) {
      reason = "DATA_ENTREGA_AUSENTE";
    } else {
      try {
        const eligibility = calculateOrderModificationDeadline(order.deliveryDate, { now });
        deadline = eligibility.deadline;
        canModify = eligibility.canModify;
        reason = canModify ? null : "PRAZO_OPERACIONAL_EXPIRADO";
      } catch {
        reason = "DATA_ENTREGA_INVALIDA";
      }
    }

    const nowIso = now.toISOString();
    const deadlineIso = deadline?.toISOString() ?? null;
    const companyId = Number(order.companyId ?? actor.companyId ?? 0) || null;
    const orderId = Number(order.id ?? 0) || null;
    const orderCode = order.orderCode ?? order.vfCode ?? (orderId ? `#${orderId}` : null);
    await this.repo.createLog({
      action: "ORDER_MODIFICATION_DEADLINE_CHECK",
      description: JSON.stringify({
        orderId,
        orderCode,
        companyId,
        userId: actor.userId ?? null,
        source,
        attemptDate: nowIso,
        deadlineCalculated: deadlineIso,
        currentDate: nowIso,
        allowed: canModify,
        reason,
      }),
      companyId: companyId ?? undefined,
      userId: actor.userId,
      userEmail: actor.email,
      userRole: actor.role ?? (actor.companyId ? "CLIENT" : "INTERNAL"),
      level: canModify ? "INFO" : "WARN",
    });
    return { deadline: deadlineIso, canModify, reason };
  }

  private async assertPeriodOpen(orderId: number, source: string): Promise<void> {
    const data = await this.repo.get(orderId);
    if (!data) return;
    return this.assertPeriodOpenForOrder(data.order as any, source);
  }

  /**
   * Variante por objeto — recebe um pedido já lido e valida se o mês
   * de `createdAt` está aberto para o tenant. Em mês fechado:
   *   - log [SECURITY] PERIODO_FECHADO | companyId=X | year=Y | month=Z
   *   - lança ForbiddenError("PERIODO_FECHADO") → 403 via errorHandler.
   *
   * Falha aberta (default = aberto) se faltar `companyId`, `createdAt`,
   * ou tenant no contexto — preserva 100% o comportamento atual quando
   * a tabela `fiscal_closures` não tem registros para a empresa.
   */
  private async assertPeriodOpenForOrder(
    order: { companyId?: number | null; createdAt?: Date | string | null },
    source: string,
  ): Promise<void> {
    const companyId = Number(order?.companyId ?? 0);
    if (!Number.isInteger(companyId) || companyId <= 0) return;

    const raw = order?.createdAt;
    const createdAt =
      raw instanceof Date ? raw : raw ? new Date(raw as any) : null;
    if (!createdAt || isNaN(createdAt.getTime())) return;

    const closed = await isPeriodClosed(companyId, createdAt);
    if (!closed) return;

    const year = createdAt.getFullYear();
    const month = createdAt.getMonth() + 1;
    console.warn(
      `[SECURITY] PERIODO_FECHADO | requestId=${getRequestIdForLog()} | source=${source} | companyId=${companyId} | year=${year} | month=${month}`,
    );
    throw new ForbiddenError("PERIODO_FECHADO");
  }
}

export const ordersService = new OrdersService();
