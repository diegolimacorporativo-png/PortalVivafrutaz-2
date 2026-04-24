/**
 * Finance module — public entry point.
 *
 * The module loader (server/modules/index.ts) imports `definition` from here.
 * The shape `{ basePath, router }` is the contract every module must implement.
 */
import { financeRouter } from "./finance.routes";

export const definition = {
  name: "finance",
  basePath: "/api/finance",
  router: financeRouter,
} as const;

export type ModuleDefinition = typeof definition;
