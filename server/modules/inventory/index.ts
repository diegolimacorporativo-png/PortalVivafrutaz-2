/**
 * Inventory module — public entry point.
 *
 * The module loader (`server/modules/index.ts`) imports `definition` from
 * here. The shape `{ name, basePath, router }` is the contract every module
 * implements; it lets the loader mount the same router at `/api/inventory`
 * AND `/api/v1/inventory` with zero code duplication.
 */
import { inventoryRouter } from "./inventory.routes";

export const definition = {
  name: "inventory",
  basePath: "/api/inventory",
  router: inventoryRouter,
} as const;

export type ModuleDefinition = typeof definition;
