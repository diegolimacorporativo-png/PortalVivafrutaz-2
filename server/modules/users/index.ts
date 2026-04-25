/**
 * Users module — public entry point.
 *
 * The module loader (server/modules/index.ts) imports `definition` from here.
 * The shape `{ name, basePath, router }` is the contract every module must
 * implement.
 */
import { usersRouter } from "./users.routes";
import { usersAdminRouter } from "./users.admin.routes";

export const definition = {
  name: "users",
  basePath: "/api/users",
  router: usersRouter,
} as const;

/**
 * Secondary mount for privileged user-management endpoints under
 * `/api/admin/users`. Kept as its own definition so the central loader can
 * register it without breaking the existing `{ name, basePath, router }`
 * contract used by every other module.
 */
export const adminDefinition = {
  name: "users-admin",
  basePath: "/api/admin/users",
  router: usersAdminRouter,
} as const;

export type ModuleDefinition = typeof definition;
