/**
 * Auth module — public entry point.
 *
 * The module loader (server/modules/index.ts) imports `definition` from here.
 * The shape `{ name, basePath, router }` is the contract every module must
 * implement.
 */
import { authRouter } from "./auth.routes";

export const definition = {
  name: "auth",
  basePath: "/api/auth",
  router: authRouter,
} as const;

export type ModuleDefinition = typeof definition;
