import { Router } from "express";
import { asyncHandler } from "../../core/http/asyncHandler";
import { validateRequest } from "../../core/validation/validateRequest";
import { ordersController } from "./orders.controller";
import { idParamSchema, listOrdersQuerySchema } from "./orders.validation";

/**
 * Orders router — wires HTTP method+path → middleware chain → controller.
 *
 * Migration status (intentional):
 *   ✅ GET  /api/orders            → modular (envelope response)
 *   ✅ GET  /api/orders/:id        → modular (envelope response)
 *   🚧 POST /api/orders            → legacy (heavy side-effects: push,
 *                                    email, auto-logistics, dup-protect,
 *                                    test-mode, maintenance-mode, …)
 *   🚧 PATCH/DELETE/action routes  → legacy
 *
 * Anything not declared here falls through `next()` to the legacy
 * `server/routes/routes.ts`, so backward compatibility is total. Modules are
 * mounted BEFORE the legacy router (see `server/modules/index.ts`), so the
 * migrated GETs win the route match while everything else continues to work.
 *
 * NOTE: this router intentionally does NOT mount `requireAuth` globally —
 * the legacy GETs above are currently public, and changing the auth contract
 * is out of scope for the structural migration. Auth tightening will land in
 * the same follow-up that migrates the mutation endpoints.
 */
const router = Router();

router.get(
  "/",
  validateRequest(listOrdersQuerySchema, "query"),
  asyncHandler(ordersController.list),
);

router.get(
  "/:id",
  ordersController.ensureNumericId,
  validateRequest(idParamSchema, "params"),
  asyncHandler(ordersController.get),
);

export const ordersRouter = router;
