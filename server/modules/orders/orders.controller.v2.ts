import type { NextFunction, Request, Response } from "express";
import { ordersService, OrdersService, ActorContext } from "./orders.service";
import { ok, created, noContent } from "../../shared/utils/apiResponse";
import type { OrderStatus } from "./orders.workflow";
// FASE 6 — guard de tenant para leitura de pedido por id (v2).
// Bloqueia vazamento entre empresas em GET endpoints.
import { validateOrderTenant } from "../../core/security/tenantGuard";

/**
 * OrdersControllerV2 — the v2 HTTP adapter for the orders module.
 *
 * Contract: EVERY response MUST use a helper from `shared/utils/apiResponse`.
 *   ok()        → 200  { success: true, data: T }
 *   created()   → 201  { success: true, data: T }
 *   noContent() → 204  (empty body)
 *   fail()      → 4xx/5xx { success: false, error }
 *
 * Differences from v1 (orders.controller.ts):
 *
 *   | Endpoint                     | v1          | v2          | Reason          |
 *   | ---------------------------- | ----------- | ----------- | --------------- |
 *   | DELETE  /:id                 | 200 + body  | 204 no body | REST DELETE     |
 *   | DELETE  /bulk                | 200 + body  | 204 no body | REST DELETE     |
 *   | POST    /create-with-delivery| 200         | 201         | Creates resource|
 *
 * All other endpoints are identical to v1.
 * Business logic lives exclusively in the service — this controller only
 * calls the service and maps the result to an HTTP response.
 */
export class OrdersControllerV2 {
  constructor(private readonly service: OrdersService = ordersService) {}

  private actor(req: Request): ActorContext {
    const s: any = (req as any).session || {};
    return {
      userId: s.userId,
      companyId: s.companyId,
      ip:
        (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
        req.socket.remoteAddress ||
        "",
    };
  }

  // ── READS ───────────────────────────────────────────────────────────
  /** GET /api/v2/orders */
  list = async (req: Request, res: Response) => {
    const { empresaId } = req.query as { empresaId?: number };
    return ok(res, await this.service.list({ empresaId }));
  };

  /** GET /api/v2/orders/:id */
  get = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.get(id));
  };

  /** GET /api/v2/orders/export */
  export = async (req: Request, res: Response) => {
    const { dateFrom, dateTo, companyId, orderType } = req.query as any;
    return ok(
      res,
      await this.service.export({ dateFrom, dateTo, companyId, orderType }),
    );
  };

  /** GET /api/v2/orders/reopen-requests */
  reopenRequests = async (req: Request, res: Response) => {
    return ok(res, await this.service.listReopenRequests(this.actor(req)));
  };

  // ── CREATE ──────────────────────────────────────────────────────────
  /** POST /api/v2/orders → 201 Created */
  create = async (req: Request, res: Response) => {
    const result = await this.service.create(req.body, this.actor(req));
    return created(res, result.data);
  };

  /**
   * POST /api/v2/orders/create-with-delivery → 201 Created
   *
   * v2 change: was 200 OK in v1 because the legacy caller expected it.
   * A POST that creates a persisted resource correctly returns 201.
   */
  createWithDelivery = async (req: Request, res: Response) => {
    const result = await this.service.createWithDelivery(
      req.body,
      this.actor(req),
    );
    return created(res, result);
  };

  // ── UPDATE ──────────────────────────────────────────────────────────
  /** PATCH /api/v2/orders/:id → 200 with updated resource */
  update = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.update(id, req.body));
  };

  // ── DELETE ──────────────────────────────────────────────────────────
  /**
   * DELETE /api/v2/orders/:id → 204 No Content
   *
   * v2 change: v1 returns 200 + a confirmation body. REST convention for a
   * successful DELETE that leaves nothing to return is 204. The service still
   * runs all side-effects (audit log, stock restoration, etc.) — only the
   * HTTP response changes.
   */
  remove = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    await this.service.remove(id, req.body || {}, this.actor(req));
    return noContent(res);
  };

  /**
   * DELETE /api/v2/orders/bulk → 204 No Content
   *
   * Same rationale as remove above.
   */
  bulkDelete = async (req: Request, res: Response) => {
    await this.service.bulkDelete(req.body, this.actor(req));
    return noContent(res);
  };

  // ── REOPEN ──────────────────────────────────────────────────────────
  /** POST /api/v2/orders/:id/request-reopen */
  requestReopen = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const { reason } = req.body as { reason: string };
    return ok(
      res,
      await this.service.requestReopen(id, reason, this.actor(req)),
    );
  };

  /** POST /api/v2/orders/:id/approve-reopen */
  approveReopen = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.approveReopen(id, this.actor(req)));
  };

  /** POST /api/v2/orders/:id/deny-reopen */
  denyReopen = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.denyReopen(id, this.actor(req)));
  };

  /** POST /api/v2/orders/:id/finalize-edit */
  finalizeEdit = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const { items } = req.body as { items?: any[] };
    return ok(
      res,
      await this.service.finalizeEdit(id, items, this.actor(req)),
    );
  };

  // ── ITEMS ───────────────────────────────────────────────────────────
  /** PUT /api/v2/orders/:id/items */
  replaceItems = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const { items } = req.body as { items: any[] };
    return ok(res, await this.service.replaceItems(id, items));
  };

  /** POST /api/v2/orders/:id/substitute-item */
  substituteItem = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(
      res,
      await this.service.substituteItem(id, req.body, this.actor(req)),
    );
  };

  // ── FISCAL / DANFE / ERP ────────────────────────────────────────────
  /** GET /api/v2/orders/:id/danfe-logs */
  listDanfeLogs = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    // FASE 6 — multi-tenant hardening: logs de DANFE expõem timestamps e
    // payloads sensíveis. Bloqueia inspeção cruzada antes do service.
    await validateOrderTenant(id);
    return ok(res, await this.service.listDanfeLogs(id, this.actor(req)));
  };

  /** POST /api/v2/orders/:id/danfe-log → 201 Created */
  createDanfeLog = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return created(
      res,
      await this.service.createDanfeLog(id, req.body || {}, this.actor(req)),
    );
  };

  /** PATCH /api/v2/orders/:id/fiscal */
  updateFiscal = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(
      res,
      await this.service.updateFiscal(id, req.body || {}, this.actor(req)),
    );
  };

  /** POST /api/v2/orders/:id/generate-prenota */
  generatePrenota = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.generatePrenota(id, this.actor(req)));
  };

  /** POST /api/v2/orders/:id/bling-export */
  blingExport = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.blingExport(id, this.actor(req)));
  };

  // ── WORKFLOW TRANSITION ─────────────────────────────────────────────
  /** POST /api/v2/orders/:id/transition */
  transition = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const { to, reason } = req.body as { to: OrderStatus; reason?: string };
    return ok(
      res,
      await this.service.transition(id, to, this.actor(req), reason),
    );
  };

  /** GET /api/v2/orders/:id/export-erp */
  exportErp = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    // FASE 6 — multi-tenant hardening: export-erp expõe dados fiscais e
    // de itens do pedido. Bloqueia inspeção cruzada antes do service.
    await validateOrderTenant(id);
    return ok(res, await this.service.exportErp(id, this.actor(req)));
  };

  /**
   * Numeric-id guard — identical to v1. Defense-in-depth against non-numeric
   * path segments hitting `/:id`. Passes `next("router")` so the legacy chain
   * can handle paths not yet migrated to this module.
   */
  ensureNumericId = (req: Request, _res: Response, next: NextFunction) => {
    const raw = (req.params as any).id;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || String(n) !== String(raw)) {
      return next("router");
    }
    return next();
  };
}

export const ordersControllerV2 = new OrdersControllerV2();
