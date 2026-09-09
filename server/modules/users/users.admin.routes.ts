import { Router } from "express";
import { asyncHandler } from "../../shared/utils/asyncHandler";
import { usersController } from "./users.controller";
import { requireAuth, requireRole } from "../../core/http/requireAuth";
import { tenantContext } from "../../middleware/tenant";

/**
 * Admin-prefixed users router — mounted at `/api/admin/users`.
 *
 * Architecture decision: privileged user-management endpoints that live under
 * the legacy `/api/admin/...` namespace cannot be served from the main users
 * router (which is mounted at `/api/users`). Rather than scatter the
 * delegation back into `routes.ts`, we expose a second router from the users
 * module so every users-related endpoint stays inside the module boundary.
 *
 * The module loader (`server/modules/index.ts`) imports `adminDefinition`
 * alongside `definition` and mounts both at registration time.
 */
const router = Router();

router.use(tenantContext);
router.post(
  "/:id/unlock",
  requireAuth,
  requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]),
  asyncHandler(usersController.unlock),
);

export { router as usersAdminRouter };
