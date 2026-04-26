/**
 * Fiscal module — public entry point (STEP FISCAL 1).
 *
 * Camada NF-Draft 100% isolada: NÃO modifica nenhum endpoint existente
 * de orders, finance, nfe, nf-manual ou fiscal-invoices.
 *
 * Mount path canônico: /api/fiscal (e /api/v1/fiscal pelo registrar v1).
 */
import { fiscalRouter } from "./fiscal.routes";

export const definition = {
  name: "fiscal",
  basePath: "/api/fiscal",
  router: fiscalRouter,
} as const;

export type ModuleDefinition = typeof definition;
