import type { NextFunction, Request, Response } from "express";
import { ordersService, OrdersService } from "./orders.service";
import { ok } from "../../core/http/apiResponse";

/**
 * OrdersController — thin HTTP adapter.
 *
 * Architecture decision: controllers do three things and nothing else:
 *   1. Pull pre-validated input out of `req` (validation already happened
 *      via `validateRequest`).
 *   2. Call the service.
 *   3. Shape the response via `apiResponse` helpers (`ok`, `created`, etc.).
 * No business logic. No DB calls. No Zod. No try/catch — `asyncHandler`
 * funnels rejections into the central error handler that emits the standard
 * `{ success: false, error }` envelope.
 */
export class OrdersController {
  constructor(private readonly service: OrdersService = ordersService) {}

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

  /**
   * Numeric-id guard for `/:id`-style routes.
   *
   * The legacy router still owns sibling paths like `/api/orders/export` and
   * `/api/orders/reopen-requests`. Without this guard, a request such as
   * `GET /api/orders/export` would enter our `/:id` handler with id="export",
   * shadowing the legacy endpoint. By bailing out (`next()`) when the segment
   * isn't a positive integer, we let Express keep walking the middleware
   * stack and reach the legacy route registered later in `server/routes/routes.ts`.
   *
   * This is the *only* place backward-compat magic lives — keeping it in a
   * named middleware makes it easy to delete once those legacy routes also
   * move into this module.
   */
  ensureNumericId = (req: Request, _res: Response, next: NextFunction) => {
    const raw = (req.params as any).id;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || String(n) !== String(raw)) {
      // `next('router')` exits the orders router entirely (vs. `next()` which
      // would continue to the next middleware on this same route, e.g.
      // validateRequest), letting Express resume the app-level chain and
      // reach the legacy handler in `server/routes/routes.ts`.
      return next("router");
    }
    return next();
  };
}

export const ordersController = new OrdersController();
