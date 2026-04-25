import { Router } from "express";
import { asyncHandler } from "../../shared/utils/asyncHandler";
import { usersController } from "./users.controller";

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

router.post("/:id/unlock", asyncHandler(usersController.unlock));

export { router as usersAdminRouter };
