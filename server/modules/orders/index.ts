/**
 * Orders module — public entry point.
 *
 * The module loader (server/modules/index.ts) imports `definition` from here.
 * The shape `{ name, basePath, router }` is the contract every module must
 * implement.
 */
import { ordersRouter } from "./orders.routes";

export const definition = {
  name: "orders",
  basePath: "/api/orders",
  router: ordersRouter,
} as const;

export type ModuleDefinition = typeof definition;
