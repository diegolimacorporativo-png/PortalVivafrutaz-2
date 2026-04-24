/**
 * Users module — public entry point.
 *
 * The module loader (server/modules/index.ts) imports `definition` from here.
 * The shape `{ name, basePath, router }` is the contract every module must
 * implement.
 */
import { usersRouter } from "./users.routes";

export const definition = {
  name: "users",
  basePath: "/api/users",
  router: usersRouter,
} as const;

export type ModuleDefinition = typeof definition;
