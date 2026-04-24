import { Router } from "express";
import { asyncHandler } from "../../core/http/asyncHandler";
import { validateRequest } from "../../core/validation/validateRequest";
import { usersController } from "./users.controller";
import {
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
  idParamSchema,
} from "./users.validation";

/**
 * Users router — wires HTTP method+path → middleware chain → controller.
 *
 * Architecture decision: identical to the finance router. Reading this file
 * alone tells you the full HTTP contract of the module.
 *
 * AUTH NOTE:
 * Unlike the finance module (where every endpoint requires auth), the legacy
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
router.get("/", asyncHandler(usersController.list));

// ── Create ──────────────────────────────────────────────────────────────
router.post(
  "/",
  validateRequest(createUserSchema),
  asyncHandler(usersController.create),
);

// ── Update ──────────────────────────────────────────────────────────────
router.put(
  "/:id",
  validateRequest(idParamSchema, "params"),
  validateRequest(updateUserSchema),
  asyncHandler(usersController.update),
);

// ── Delete ──────────────────────────────────────────────────────────────
router.delete(
  "/:id",
  validateRequest(idParamSchema, "params"),
  asyncHandler(usersController.remove),
);

// ── Privileged: change password ─────────────────────────────────────────
router.put(
  "/:id/password",
  validateRequest(idParamSchema, "params"),
  validateRequest(changePasswordSchema),
  asyncHandler(usersController.changePassword),
);

export const usersRouter = router;
