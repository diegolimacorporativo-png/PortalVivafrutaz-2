import type { NextFunction, Request, Response } from "express";
import { ordersService, OrdersService, ActorContext } from "./orders.service";
import { ok, created, noContent } from "../../shared/utils/apiResponse";
import type { OrderStatus } from "./orders.workflow";

/**
 * OrdersController — thin HTTP adapter.
 *
 * Architecture decision: controllers do three things and nothing else:
 *   1. Pull pre-validated input out of `req` (validation already happened
 *      via `validateRequest`).
 *   2. Build an `ActorContext` from `req.session` and call the service.
 *   3. Shape the response via `apiResponse` helpers (`ok`, `created`,
 *      `noContent`).
 * No business logic. No DB calls. No Zod. No try/catch — `asyncHandler`
 * funnels rejections into the central error handler that emits the standard
 * `{ success: false, error }` envelope.
 *
 * AUTH NOTE: this module deliberately does NOT mount `requireAuth` globally
 * because the GET endpoints are public per the legacy contract. Per-route
 * role checks live in the service (see `service.requireRole(...)`) so the
 * controller stays declarative.
 */
export class OrdersController {
  constructor(private readonly service: OrdersService = ordersService) {}

  /**
   * Pull the caller's session bits into a plain DTO. Centralized so we
   * never reach into `req.session` from the service layer.
   */
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
  /** GET /api/orders?empresaId=<n> */
  list = async (req: Request, res: Response) => {
    const { empresaId } = req.query as { empresaId?: number };
    return ok(res, await this.service.list({ empresaId }));
  };

  /** GET /api/orders/:id */
  get = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.get(id));
  };

  /** GET /api/orders/export */
  export = async (req: Request, res: Response) => {
    const { dateFrom, dateTo, companyId, orderType } = req.query as any;
    return ok(
      res,
      await this.service.export({ dateFrom, dateTo, companyId, orderType }),
    );
  };

  /** GET /api/orders/reopen-requests */
  reopenRequests = async (req: Request, res: Response) => {
    return ok(res, await this.service.listReopenRequests(this.actor(req)));
  };

  // ── CREATE ──────────────────────────────────────────────────────────
  /** POST /api/orders */
  create = async (req: Request, res: Response) => {
    const result = await this.service.create(req.body, this.actor(req));
    return created(res, result.data);
  };

  /** POST /api/orders/create-with-delivery */
  createWithDelivery = async (req: Request, res: Response) => {
    const result = await this.service.createWithDelivery(
      req.body,
      this.actor(req),
    );
    return ok(res, result);
  };

  // ── UPDATE / DELETE ─────────────────────────────────────────────────
  /** PATCH /api/orders/:id */
  update = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.update(id, req.body));
  };

  /** DELETE /api/orders/:id */
  remove = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.remove(id, req.body || {}, this.actor(req)));
  };

  /** DELETE /api/orders/bulk */
  bulkDelete = async (req: Request, res: Response) => {
    return ok(res, await this.service.bulkDelete(req.body, this.actor(req)));
  };

  // ── REOPEN ──────────────────────────────────────────────────────────
  /** POST /api/orders/:id/request-reopen */
  requestReopen = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const { reason } = req.body as { reason: string };
    return ok(res, await this.service.requestReopen(id, reason, this.actor(req)));
  };

  /** POST /api/orders/:id/approve-reopen */
  approveReopen = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.approveReopen(id, this.actor(req)));
  };

  /** POST /api/orders/:id/deny-reopen */
  denyReopen = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.denyReopen(id, this.actor(req)));
  };

  /** GET /api/orders/:id/timeline */
  timeline = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.getOrderTimeline(id, this.actor(req)));
  };

  /** POST /api/orders/:id/finalize-edit */
  finalizeEdit = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const { items } = req.body as { items?: any[] };
    return ok(res, await this.service.finalizeEdit(id, items, this.actor(req)));
  };

  // ── ITEMS ───────────────────────────────────────────────────────────
  /** PUT /api/orders/:id/items */
  replaceItems = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const { items } = req.body as { items: any[] };
    return ok(res, await this.service.replaceItems(id, items, this.actor(req)));
  };

  /** POST /api/orders/:id/substitute-item */
  substituteItem = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(
      res,
      await this.service.substituteItem(id, req.body, this.actor(req)),
    );
  };

  // ── FISCAL / DANFE / ERP ────────────────────────────────────────────
  /** GET /api/orders/:id/danfe-logs */
  listDanfeLogs = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.listDanfeLogs(id, this.actor(req)));
  };

  /** POST /api/orders/:id/danfe-log */
  createDanfeLog = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return created(
      res,
      await this.service.createDanfeLog(id, req.body || {}, this.actor(req)),
    );
  };

  /** PATCH /api/orders/:id/fiscal */
  updateFiscal = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    // STEP 9.2Y.7 — audit any "Liberar agora" force-release coming from the
    // admin quick-action. Triggered by `?force=1` so the normal fiscal-update
    // flow is untouched and only the explicit override is logged here.
    if (req.query.force === "1" && (req.body as any)?.fiscalStatus === "nota_liberada") {
      const a = this.actor(req);
      console.warn("[ORDER_FORCE_RELEASE]", {
        orderId: id,
        userId: a.userId,
        ip: a.ip,
        action: "nota_liberada",
        at: new Date().toISOString(),
      });
    }
    return ok(
      res,
      await this.service.updateFiscal(id, req.body || {}, this.actor(req)),
    );
  };

  /** POST /api/orders/:id/generate-prenota */
  generatePrenota = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.generatePrenota(id, this.actor(req)));
  };

  /** POST /api/orders/:id/bling-export */
  blingExport = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.blingExport(id, this.actor(req)));
  };

  // ── WORKFLOW TRANSITION ─────────────────────────────────────────────
  /**
   * POST /api/orders/:id/transition
   *
   * Body: { to: OrderStatus, reason?: string }
   * Response: { order, workflowStatus, from }
   *
   * Moves the order's workflowStatus through the controlled state machine.
   * All existing endpoints (PATCH /api/orders/:id, fiscal, ERP, etc.) are
   * completely unaffected — this only touches `workflowStatus`.
   */
  transition = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const { to, reason } = req.body as { to: OrderStatus; reason?: string };
    return ok(
      res,
      await this.service.transition(id, to, this.actor(req), reason),
    );
  };

  /** GET /api/orders/:id/export-erp */
  exportErp = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.exportErp(id, this.actor(req)));
  };

  // ── 204 No-content (placeholder for future endpoints) ───────────────
  empty = async (_req: Request, res: Response) => noContent(res);

  /**
   * Numeric-id guard for `/:id`-style routes.
   *
   * The legacy router still owns sibling paths like `/api/orders/export` and
   * `/api/orders/reopen-requests`. Within THIS router we now also register
   * those literal paths BEFORE `/:id`, so Express picks the literal first.
   * This guard remains as defense-in-depth: if a request hits `/:id` with a
   * non-numeric segment (e.g. a future legacy literal we haven't migrated),
   * `next("router")` exits the orders router and lets the legacy chain pick
   * it up — preserving full backward compatibility.
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

export const ordersController = new OrdersController();
