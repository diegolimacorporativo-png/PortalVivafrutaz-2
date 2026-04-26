import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../../shared/errors/AppError";
import { ordersRepository, OrdersRepository } from "./orders.repository";
import type { Order, OrderDetail, OrdersListFilter } from "./orders.types";
import {
  OrderStatus,
  assertTransitionAllowed,
  assertTransitionRole,
  validateBusinessRules,
} from "./orders.workflow";
import { buildPixPayload } from "../../shared/utils/pix";
import { fireNotification } from "../../services/pushService";
import {
  sendOrderPlaced,
  sendOrderStatusChanged,
  sendAdminNewOrder,
} from "../../services/mailer";
// Price Resolver — imported for future activation only. Currently used
// only for opportunistic divergence logging via logPriceDivergence; no
// persisted value depends on it. See products/utils/priceResolver.ts.
// FUTURE:
//   - enableCategoryPricing flag
//   - enableAdminMarkup flag
//   - enableContractOverride flag
import {
  resolveProductPrice,
  logPriceDivergence,
} from "../products/utils/priceResolver";
void resolveProductPrice;
void logPriceDivergence;

/**
 * Module-local 60-second duplicate-submission window.
 *
 * Mirrors the legacy `recentOrders` Map declared inline in `routes.ts`. It
 * lives here (not in the repository) because it's a behavior — debouncing —
 * not persistence. Same key shape (`companyId:deliveryDate:orderWindowId`)
 * and same TTL guarantee identical UX with the legacy endpoint.
 */
const recentOrders = new Map<string, number>();
const DUPLICATE_WINDOW_MS = 60_000;

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
const FISCAL_ROLES = [
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
}

/**
 * OrdersService — business rules of the orders module.
 *
 * Architecture decision: services own *behavior*. They orchestrate the
 * repository, enforce invariants, and never touch req/res. Side-effects
 * (push, email, AR seed, inventory deduction, auto-logistics) are kept
 * fire-and-forget exactly as the legacy code did so a transient failure in
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

  list(filter: OrdersListFilter = {}): Promise<Order[]> {
    return this.repo.list(filter);
  }

  async get(id: number): Promise<OrderDetail> {
    const detail = await this.repo.get(id);
    if (!detail) throw new NotFoundError("Pedido não encontrado");
    return detail;
  }

  listByCompany(companyId: number): Promise<Order[]> {
    return this.repo.listByCompany(companyId);
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

    return Promise.all(
      filtered.map(async (order) => {
        const company = (allCompanies as any[]).find(
          (c) => c.id === order.companyId,
        );
        let items: any[] = [];
        try {
          const detail = await this.repo.get(order.id);
          items = detail?.items || [];
        } catch {
          /* swallow per legacy */
        }
        return {
          ...order,
          companyName: company?.companyName || `Empresa #${order.companyId}`,
          clientType: company?.clientType || "",
          items: items.map((item: any) => {
            const product = (allProducts as any[]).find(
              (p) => p.id === item.productId,
            );
            return {
              ...item,
              productName: product?.name || `Produto #${item.productId}`,
              productCategory: product?.category || "",
              productUnit: product?.unit || "",
            };
          }),
        };
      }),
    );
  }

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ CREATE                                                           ║
  // ╚══════════════════════════════════════════════════════════════════╝

  /**
   * `POST /api/orders` — create a customer-facing order.
   *
   * Replicates the legacy flow exactly:
   *   1. Maintenance-mode block (503).
   *   2. Test-mode interception (per-user `testMode` / role `SISTEMA_TESTE`,
   *      then global `test_mode` setting for client sessions).
   *   3. 60-second duplicate guard.
   *   4. Date-lock guard (one active order per company per delivery date).
   *   5. Persist with status=CONFIRMED.
   *   6. Fire-and-forget side effects: log, push, emails, auto-logistics.
   *
   * Returns either the persisted Order or a "test order" payload identical
   * to the legacy 201 response shape.
   */
  async create(
    body: { order: any; items: any[] },
    actor: ActorContext,
  ): Promise<{ data: any; isTest: boolean; status: 201 }> {
    const { order, items } = body;

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

    // 3) duplicate-submission window
    const dupKey = `${order.companyId}:${order.deliveryDate || ""}:${order.orderWindowId || ""}`;
    const lastSubmit = recentOrders.get(dupKey);
    if (lastSubmit && Date.now() - lastSubmit < DUPLICATE_WINDOW_MS) {
      throw new ConflictError(
        "Pedido já enviado. Aguarde a confirmação antes de enviar novamente.",
      );
    }
    recentOrders.set(dupKey, Date.now());

    // 4) date-lock guard
    const requestedDate = new Date(order.deliveryDate);
    const requestedDateStr = requestedDate.toISOString().split("T")[0];
    const companyOrders = await this.repo.listByCompanyId(order.companyId);
    const existingForDate = companyOrders.find((o: any) => {
      if (["CANCELLED"].includes(o.status)) return false;
      const d = new Date(o.deliveryDate).toISOString().split("T")[0];
      return d === requestedDateStr;
    });
    if (existingForDate) {
      throw new ConflictError(
        "Você já possui um pedido registrado para essa data de entrega.",
        {
          existingOrderId: (existingForDate as any).id,
          existingOrderCode: (existingForDate as any).orderCode,
        },
      );
    }

    // 5) persist
    const newOrder = await this.repo.create(
      { ...order, status: "CONFIRMED" },
      items,
    );

    // 6) fire-and-forget side-effects (mirroring legacy try/catch swallow)
    this.afterCreate(newOrder, order, items).catch((err) => {
      console.error("[orders.afterCreate] side-effect error:", err);
    });

    return { data: newOrder, isTest: false, status: 201 };
  }

  /**
   * Side-effects fired after a successful create. Kept as one async function
   * so the controller can `void` it without blocking the response. Each
   * sub-step has its own try/catch so a downstream failure in (e.g.) email
   * never prevents push notifications or auto-logistics from running.
   */
  private async afterCreate(newOrder: any, order: any, items: any[]) {
    // — Log creation —
    try {
      await this.repo.createLog({
        action: "ORDER_CREATED",
        description: `Pedido criado: ${newOrder.vfCode || `#${newOrder.id}`} (empresa ${order.companyId})`,
        companyId: order.companyId,
        userRole: "CLIENT",
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
        { url: `/admin/orders` },
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
      const existingDelivery = await this.repo.getDeliveryByOrder(newOrder.id);
      if (!existingDelivery) {
        const co: any = await this.repo.getCompany(order.companyId);
        const delivDate = order.deliveryDate
          ? String(order.deliveryDate).split("T")[0]
          : null;
        await this.repo.createDelivery({
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
   * always provisions a delivery row in the same call. Faithful port.
   */
  async createWithDelivery(
    body: any,
    actor: ActorContext,
  ): Promise<{ order: any; delivery: any }> {
    if (!actor.userId) throw new UnauthorizedError();
    const acting = await this.repo.getUser(actor.userId);
    if (!acting) throw new UnauthorizedError();

    const { companyId, deliveryDate, items, ...rest } = body;
    if (!companyId) throw new BadRequestError("companyId obrigatório");

    const totalValue = (items || []).reduce(
      (s: number, i: any) => s + Number(i.totalPrice || 0),
      0,
    );

    // Pre-fetch company so we can both create the delivery row below AND
    // feed the read-only Price Resolver divergence check. This is the same
    // query that already happens further down — moved a few lines up so we
    // do NOT add an extra round-trip.
    const company: any = await this.repo.getCompany(companyId);

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

    // ── FEATURE FLAG — per-company new pricing (STEP 3.8) ──
    // Default = legacy. Only flips when company.useNewPricing === true
    // (strict equality — undefined / null / truthy-soup never count).
    // When ON, we replace each item's unitPrice/totalPrice using the
    // central resolver and recompute the order totalValue. Rollback is
    // a single UPDATE: companies.use_new_pricing = false.
    let computedTotal = totalValue;
    const useNewPricing = company?.useNewPricing === true;
    if (useNewPricing) {
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
          if (!product) continue;
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
        // If anything in the new path blows up, log loudly and fall back
        // to the legacy values that the client already sent.
        console.error(
          "[pricing] new pricing FAILED — falling back to legacy",
          { companyId, err: (e as Error)?.message },
        );
        computedTotal = totalValue;
      }
    }

    const order = await this.repo.create(
      {
        companyId,
        deliveryDate,
        totalValue: String(Math.round(computedTotal * 100) / 100),
        status: "ACTIVE",
        orderDate: new Date(),
        fiscalStatus: "nota_pendente",
        erpExportStatus: "nao_exportado",
        ...rest,
      } as any,
      items || [],
    );
    const delivery = await this.repo.createDelivery({
      orderId: order.id,
      companyId,
      status: "pendente",
      scheduledDate: deliveryDate || null,
      addressStreet: company?.addressStreet || null,
      addressZip: company?.addressZip || null,
      addressCity: company?.addressCity || null,
      addressState: company?.addressState || null,
    });

    return { order, delivery };
  }

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ UPDATE                                                           ║
  // ╚══════════════════════════════════════════════════════════════════╝

  /**
   * `PATCH /api/orders/:id` — admin updates status/notes/nimbi. Persists
   * the change synchronously and fires status-change side-effects (email,
   * push, inventory deduction on CONFIRMED, account-receivable seed on
   * CONFIRMED) as fire-and-forget.
   */
  async update(
    id: number,
    body: { status?: string; adminNote?: string; nimbiExpiration?: string | null; [k: string]: any },
  ): Promise<Order> {
    const { status, adminNote, nimbiExpiration } = body;
    const updates: any = {};
    if (status !== undefined) updates.status = status;
    if (adminNote !== undefined) updates.adminNote = adminNote;
    if (nimbiExpiration !== undefined)
      updates.nimbiExpiration = nimbiExpiration || null;

    const updated = await this.repo.update(id, updates);

    // Side-effects (email + push for status changes) — fire and forget.
    if (status && ["CONFIRMED", "DELIVERED", "CANCELLED"].includes(status)) {
      this.afterStatusChange(id, status, adminNote).catch((err) =>
        console.error("[orders.afterStatusChange]", err),
      );
    }
    if (status === "CONFIRMED") {
      this.deductInventoryOnConfirm(id).catch((err) =>
        console.error("[INVENTORY] Erro ao baixar estoque do pedido:", err),
      );
      this.seedAccountReceivableOnConfirm(id).catch((err) =>
        console.error("[FINANCE] Erro ao criar conta a receber:", err),
      );
    }
    return updated;
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
   *   Load order, acting user, company, AR. Fail fast with 4xx before
   *   opening any transaction slot.
   *
   * PHASE 2 — Validation (pure, synchronous after reads)
   *   a. Auth: actor must be an authenticated staff user.
   *   b. State guard: `assertTransitionAllowed` rejects illegal arcs.
   *   c. RBAC: `assertTransitionRole` rejects under-privileged callers.
   *   d. Business rules: `validateBusinessRules` checks domain invariants
   *      (customer active/not-locked, no overdue AR, invoice present for SHIP).
   *
   * PHASE 3 — Atomic transaction (critical — all-or-nothing)
   *   Calls `executeWorkflowTransaction` which runs inside a single pg BEGIN.
   *   Writes: workflowStatus + status (legacy sync) + per-transition critical
   *   ops (pre-nota, inventory deduction, AR creation, delivery status update).
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
   *   - Inventory deduction is idempotent only if the workflow state machine
   *     is respected (APPROVED can only be entered once). The transition guard
   *     enforces this.
   */
  async transition(
    id: number,
    to: OrderStatus,
    actor: ActorContext,
    reason?: string,
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

    const [company, arByCompany, allProducts, companyConfig] = await Promise.all([
      this.repo.getCompany(orderRow.companyId),
      this.repo.getAccountsReceivableByCompanyId(orderRow.companyId),
      this.repo.getProducts(),
      this.repo.getCompanyConfig(),
    ]);

    // ── Phase 2: Validation (pure — all reads are done, no writes yet) ───────
    assertTransitionAllowed(from, to);
    assertTransitionRole(to, user.role);

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

    validateBusinessRules({ orderId: id, to, company, orderRow, arByCompany });

    // Enrich items with productName before entering the transaction so the tx
    // body only needs to do writes — no products table lookup under lock.
    const productMap    = new Map(allProducts.map((p: any) => [p.id, p]));
    const enrichedItems = (orderData.items as any[]).map((item) => ({
      ...item,
      productName:
        (productMap.get(item.productId) as any)?.name ||
        `Produto #${item.productId}`,
    }));

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
      itemsSnapshot:          enrichedItems,
      companyConfig,
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
    if (txResult.inventoryLinesDeducted) details.inventoryLinesDeducted = txResult.inventoryLinesDeducted;
    if (txResult.arCreated)              details.arCreated              = true;
    if (txResult.deliveryUpdated)        details.deliveryUpdated        = true;

    return {
      order:          txResult.updatedOrder as unknown as Order,
      workflowStatus: to,
      from,
      details,
    };
  }

  private async afterStatusChange(
    id: number,
    status: string,
    adminNote?: string,
  ) {
    try {
      const orderData = await this.repo.get(id);
      if (!orderData) return;
      const oa: any = orderData.order;
      const company = await this.repo.getCompany(oa.companyId);
      if (company) {
        await sendOrderStatusChanged({
          toEmail: company.email,
          companyName: company.companyName,
          vfCode: oa.vfCode || `#${id}`,
          status,
          adminNote,
        });
      }
      const companyName = company?.companyName || `Empresa #${oa.companyId}`;
      if (status === "CANCELLED") {
        fireNotification(
          "order_cancelled",
          { code: oa.vfCode || `#${id}`, company: companyName },
          { url: `/admin/orders` },
        );
      } else {
        const statusLabel: Record<string, string> = {
          CONFIRMED: "Confirmado",
          DELIVERED: "Entregue",
          CANCELLED: "Cancelado",
        };
        fireNotification(
          "order_updated",
          {
            code: oa.vfCode || `#${id}`,
            company: companyName,
            status: statusLabel[status] || status,
          },
          { url: `/admin/orders` },
        );
      }
    } catch (emailErr) {
      console.error("[EMAIL] Erro ao enviar email de status:", emailErr);
    }
  }

  private async deductInventoryOnConfirm(id: number) {
    const orderData = await this.repo.get(id);
    if (!orderData) return;
    const allProducts = await this.repo.getProducts();
    const productMap = new Map(allProducts.map((p: any) => [p.id, p]));
    const today = new Date().toISOString().split("T")[0];
    for (const item of orderData.items as any[]) {
      const product: any = productMap.get(item.productId);
      const productName = product?.name || `Produto #${item.productId}`;
      const setting =
        (await this.repo.getInventorySettingByProductId(item.productId)) ||
        (await this.repo.getInventorySettingByProductName(productName));
      if (!setting) continue;
      const prev = parseFloat((setting as any).currentStock || "0");
      const qty = parseFloat(String(item.quantity || 0));
      const newStock = Math.max(0, prev - qty);
      await this.repo.upsertInventorySetting({
        ...setting,
        currentStock: String(newStock),
      });
      await this.repo.createInventoryMovement({
        productId: item.productId || null,
        productName,
        movementType: "EXIT",
        quantity: String(qty),
        balanceAfter: String(newStock),
        unit: (setting as any).unit,
        referenceType: "order",
        referenceId: id,
        notes: `Pedido confirmado: ${(orderData.order as any).orderCode || `#${id}`}`,
        date: today,
        createdBy: "Sistema",
      });
    }
  }

  private async seedAccountReceivableOnConfirm(id: number) {
    const existing = await this.repo.getAccountReceivableByOrderId(id);
    if (existing) return;
    const orderData = await this.repo.get(id);
    if (!orderData) return;
    const oa: any = orderData.order;
    const total = (orderData.items as any[]).reduce(
      (sum, item) => sum + parseFloat(item.totalPrice || "0"),
      0,
    );
    if (total <= 0) return;
    const today = new Date();
    const due = new Date(today);
    due.setDate(due.getDate() + 30);
    const toDate = (d: Date) => d.toISOString().split("T")[0];
    const config: any = await this.repo.getCompanyConfig();
    const pixPayload = config?.cnpj
      ? buildPixPayload(config.cnpj, total, config.companyName, config.city)
      : undefined;
    await this.repo.createAccountReceivable({
      companyId: oa.companyId,
      orderId: id,
      descricao: `Pedido ${oa.orderCode || oa.vfCode || `#${id}`}`,
      valor: total.toFixed(2),
      dataEmissao: toDate(today),
      dataVencimento: toDate(due),
      status: "pendente",
      formaPagamento: "pix",
      pixPayload,
    });
  }

  // ╔══════════════════════════════════════════════════════════════════╗
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
    if (!data) throw new NotFoundError("Pedido não encontrado");
    const isFiscal = ["nota_emitida", "nota_exportada"].includes(
      (data.order as any).fiscalStatus || "",
    );
    if (isFiscal && !body.confirmar) {
      throw new ConflictError("Confirmação necessária", {
        requiresConfirmation: true,
        orderCode: (data.order as any).orderCode || String(id),
      });
    }
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
    const ids = (body.orderIds || []).map((x) => Number(x));

    const orderResults = await Promise.all(ids.map((i) => this.repo.get(i)));
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

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ ITEMS                                                            ║
  // ╚══════════════════════════════════════════════════════════════════╝

  async replaceItems(id: number, items: any[]): Promise<OrderDetail> {
    if (!Array.isArray(items)) throw new BadRequestError("items required");

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

    // ── FEATURE FLAG — per-company new pricing (STEP 3.8) ──
    // Reuse the company already loaded for the observer above. Only
    // touches item prices when company.useNewPricing === true.
    try {
      if (observedCompanyId != null) {
        const company: any = await this.repo.getCompany(observedCompanyId);
        if (company?.useNewPricing === true) {
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
            if (!product) continue;
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
        "[pricing] new pricing FAILED — falling back to legacy",
        { method: "replaceItems", orderId: id, err: (e as Error)?.message },
      );
    }

    await this.repo.updateItems(id, items as any);
    const result = await this.repo.get(id);
    if (!result) throw new NotFoundError("Pedido não encontrado");
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

      // ── FEATURE FLAG — per-company new pricing (STEP 3.8) ──
      // Only takes effect when company.useNewPricing === true.
      try {
        const cId = (detail.order as any)?.companyId ?? null;
        if (cId != null) {
          const company: any = await this.repo.getCompany(cId);
          if (company?.useNewPricing === true) {
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
          "[pricing] new pricing FAILED — falling back to legacy",
          {
            method: "substituteItem.replace",
            orderId,
            itemId,
            err: (e as Error)?.message,
          },
        );
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
    await this.requireRole(actor, FISCAL_ROLES, "Sem permissão");
    const updates: any = {};
    if (body.fiscalStatus) updates.fiscalStatus = body.fiscalStatus;
    if (body.preNotaNumber !== undefined)
      updates.preNotaNumber = body.preNotaNumber;
    return this.repo.update(id, updates);
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
}

export const ordersService = new OrdersService();
