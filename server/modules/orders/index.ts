/**
 * Orders module — public entry point.
 *
 * The module loader (server/modules/index.ts) imports `definition` from here.
 * The shape `{ name, basePath, router }` is the contract every module must
 * implement.
 */
import { companyOrdersRouter, ordersRouter } from "./orders.routes";

export const definition = {
  name: "orders",
  basePath: "/api/orders",
  router: ordersRouter,
} as const;

/** Client-compatible URL retained from the legacy API, implemented by orders. */
export const companyOrdersDefinition = {
  name: "orders-by-company",
  basePath: "/api/companies",
  router: companyOrdersRouter,
} as const;

export type ModuleDefinition = typeof definition;
