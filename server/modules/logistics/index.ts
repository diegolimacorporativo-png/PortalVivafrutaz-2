/**
 * Logistics module — public entry point.
 *
 * The module loader (`server/modules/index.ts`) imports `definition` from
 * here. The shape `{ name, basePath, router }` is the contract every module
 * implements; it lets the loader mount the same router at `/api/logistics`
 * AND `/api/v1/logistics` with zero code duplication.
 */
import { logisticsRouter } from "./logistics.routes";

export const definition = {
  name: "logistics",
  basePath: "/api/logistics",
  router: logisticsRouter,
} as const;

export type ModuleDefinition = typeof definition;
