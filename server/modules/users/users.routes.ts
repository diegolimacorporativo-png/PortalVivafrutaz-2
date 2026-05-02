import { Router } from "express";
import { asyncHandler } from "../../shared/utils/asyncHandler";
import { validate } from "../../shared/middlewares/validate";
import { usersController } from "./users.controller";
import { checkPlanLimit } from "../billing/subscription.middleware";
import {
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
  idParamSchema,
} from "./users.validation";
// C2-FIX: users CRUD endpoints were completely unauthenticated — now require
// a valid admin session. Role enforcement (ADMIN/MASTER) is applied per route.
import { requireAuth, requireRole } from "../../core/http/requireAuth";

/**
 * Users router — wires HTTP method+path → middleware chain → controller.
 *
 * Architecture decision: identical to the orders router. Reading this file
 * alone tells you the full HTTP contract of the module.
 *
 * Shared utilities used:
 *   - `asyncHandler`  from `shared/utils/asyncHandler`
 *   - `validate`      from `shared/middlewares/validate`
 *
 * AUTH NOTE:
 * Unlike orders (where `tenantContext` secures every endpoint), the legacy
 * users routes did NOT enforce session checks on the CRUD endpoints, and the
 * existing frontend / E2E flow rely on that. We preserve that exact behaviour
 * to avoid breaking callers. Authorisation for the privileged password-change
 * route is enforced INSIDE the service (matching the legacy actor-lookup +
 * role-gate + audit-log pattern), so the response shape stays identical too.
 *
 * ⚠ Tightening these to requireAuth + requireRole(['ADMIN', ...]) is the
 * recommended next step, but should be done as a separate, deliberate change
 * coordinated with a frontend pass — not silently during this refactor.
 */
const router = Router();

// ── List ────────────────────────────────────────────────────────────────
router.get("/", requireAuth, requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]), asyncHandler(usersController.list));

// ── Create ──────────────────────────────────────────────────────────────
router.post(
  "/",
  requireAuth,
  requireRole(["MASTER", "ADMIN"]),
  checkPlanLimit("usuarios"),
  validate(createUserSchema, "body"),
  asyncHandler(usersController.create),
);

// ── Update ──────────────────────────────────────────────────────────────
router.put(
  "/:id",
  requireAuth,
  requireRole(["MASTER", "ADMIN"]),
  validate(idParamSchema, "params"),
  validate(updateUserSchema, "body"),
  asyncHandler(usersController.update),
);

// ── Delete ──────────────────────────────────────────────────────────────
router.delete(
  "/:id",
  requireAuth,
  requireRole(["MASTER", "ADMIN"]),
  validate(idParamSchema, "params"),
  asyncHandler(usersController.remove),
);

// ── Privileged: change password ─────────────────────────────────────────
router.put(
  "/:id/password",
  requireAuth,
  requireRole(["MASTER", "ADMIN"]),
  validate(idParamSchema, "params"),
  validate(changePasswordSchema, "body"),
  asyncHandler(usersController.changePassword),
);

export const usersRouter = router;
