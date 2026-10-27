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
// User-management endpoints require an authenticated MASTER, ADMIN, or DIRECTOR.
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
 * Tenant context and strict server-side role checks protect each operation.
 * Fine-grained tab visibility is only a UI preference; APIs enforce role and
 * tenant scope independently.
 */
const router = Router();
// Resolve and pin the tenant before any user query. Tenant-bound accounts
// cannot override it with body/query values; global admins may use the
// existing explicit tenant-targeting convention.
router.use(tenantContext);

// ── List ────────────────────────────────────────────────────────────────
router.get("/", requireAuth, requireRole([...USER_MANAGEMENT_ROLES], { strict: true }), asyncHandler(usersController.list));

// ── Create ──────────────────────────────────────────────────────────────
router.post(
  "/",
  requireAuth,
  requireRole([...USER_MANAGEMENT_ROLES], { strict: true }),
  checkPlanLimit("usuarios"),
  validate(createUserSchema, "body"),
  asyncHandler(usersController.create),
);

// ── Update ──────────────────────────────────────────────────────────────
router.put(
  "/:id",
  requireAuth,
  requireRole([...USER_MANAGEMENT_ROLES], { strict: true }),
  validate(idParamSchema, "params"),
  validate(updateUserSchema, "body"),
  asyncHandler(usersController.update),
);

// ── Delete ──────────────────────────────────────────────────────────────
router.delete(
  "/:id",
  requireAuth,
  requireRole([...USER_MANAGEMENT_ROLES], { strict: true }),
  validate(idParamSchema, "params"),
  asyncHandler(usersController.remove),
);

// ── Privileged: change password ─────────────────────────────────────────
router.put(
  "/:id/password",
  requireAuth,
  requireRole([...USER_MANAGEMENT_ROLES], { strict: true }),
  validate(idParamSchema, "params"),
  validate(changePasswordSchema, "body"),
  asyncHandler(usersController.changePassword),
);

export const usersRouter = router;
