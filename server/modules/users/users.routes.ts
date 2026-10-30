import { Router } from "express";
import { asyncHandler } from "../../shared/utils/asyncHandler";
import { validate } from "../../shared/middlewares/validate";
import { usersController } from "./users.controller";
import {
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
  idParamSchema,
} from "./users.validation";
// User-management endpoints require an authenticated privileged system profile.
// Service rules further constrain tenant admins and protect global profiles.
import { requireAuth, requireRole } from "../../core/http/requireAuth";
import { tenantContext } from "../../middleware/tenant";
import { USER_MANAGEMENT_ROLES } from "@shared/user-roles";

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
 * Tenant context and server-side role checks protect each operation. User
 * identity administration intentionally ignores a legacy companyId: the
 * allowlist below is the authorization boundary for this router.
 * Persisted tab restrictions are deny-only gates on the modules that opt in;
 * role/action policies and tenant scope remain independently authoritative.
 */
const router = Router();
// Resolve the actor from the session. For authorized user managers the tenant
// middleware deliberately uses identity-management scope, not the selected
// operational company; customer accounts remain on their separate routes.
router.use(tenantContext);

// ── List ────────────────────────────────────────────────────────────────
router.get("/", requireAuth, requireRole([...USER_MANAGEMENT_ROLES]), asyncHandler(usersController.list));

// ── Create ──────────────────────────────────────────────────────────────
router.post(
  "/",
  requireAuth,
  requireRole([...USER_MANAGEMENT_ROLES]),
  validate(createUserSchema, "body"),
  asyncHandler(usersController.create),
);

// ── Update ──────────────────────────────────────────────────────────────
router.put(
  "/:id",
  requireAuth,
  requireRole([...USER_MANAGEMENT_ROLES]),
  validate(idParamSchema, "params"),
  validate(updateUserSchema, "body"),
  asyncHandler(usersController.update),
);

// ── Delete ──────────────────────────────────────────────────────────────
router.delete(
  "/:id",
  requireAuth,
  requireRole([...USER_MANAGEMENT_ROLES]),
  validate(idParamSchema, "params"),
  asyncHandler(usersController.remove),
);

// ── Privileged: change password ─────────────────────────────────────────
router.put(
  "/:id/password",
  requireAuth,
  requireRole([...USER_MANAGEMENT_ROLES]),
  validate(idParamSchema, "params"),
  validate(changePasswordSchema, "body"),
  asyncHandler(usersController.changePassword),
);

export const usersRouter = router;
