import { companiesRouter } from "./companies.routes";

/**
 * Companies module — barrel + module definition.
 *
 * The `definition` export is consumed by `server/modules/index.ts` and
 * mounted at the listed `basePath`. All public symbols are re-exported here
 * so callers depend on `./modules/companies` rather than reaching into the
 * file tree.
 */
export const definition = {
  name: "companies" as const,
  basePath: "/api/companies" as const,
  router: companiesRouter,
};

export { companiesRouter } from "./companies.routes";
export { companiesController } from "./companies.controller";
export { companiesService, CompaniesService } from "./companies.service";
export {
  companiesRepository,
  CompaniesRepository,
} from "./companies.repository";
export * from "./companies.types";
