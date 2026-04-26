import type { Express, Router } from "express";
import { definition as authModule } from "./auth";
import { definition as companiesModule } from "./companies";
import { definition as financeModule } from "./finance";
import { definition as inventoryModule } from "./inventory";
import { definition as logisticsModule } from "./logistics";
import { definition as ordersModule } from "./orders";
import { definition as productsModule, categoriesDefinition as categoriesModule } from "./products";
import { definition as usersModule, adminDefinition as usersAdminModule } from "./users";
import { ordersRouterV2 } from "./orders/orders.routes.v2";

/**
 * Central module loader.
 *
 * Architecture decision: every module exports `{ name, basePath, router }`
 * from its `index.ts`. The three registration functions below implement the
 * three mount points:
 *
 *   registerModules   → /api/<module>       (legacy — backward compat)
 *   registerV1Modules → /api/v1/<module>    (versioned alias, same behaviour)
 *   registerV2Modules → /api/v2/<module>    (new envelope, pilot = orders)
 *
 * To add a new module:
 *   1. Implement it under `server/modules/<name>/`.
 *   2. Import its `definition` here and append it to `MODULES`.
 *   3. Done — all three registrars pick it up automatically.
 *
 * To add a module to v2:
 *   4. Create `<module>.controller.v2.ts` + `<module>.routes.v2.ts`.
 *   5. Add it to `V2_MODULES`.
 *
 * Modules are mounted BEFORE the legacy `routes.ts` so that any path that has
 * been migrated takes precedence. Legacy routes that haven't been migrated
 * yet still respond from `routes.ts` — incremental migration with no flag day.
 */
interface ModuleDefinition {
  readonly name: string;
  readonly basePath: string;
  readonly router: Router;
}

/** Canonical module list — drives all three mount variants. */
const MODULES: readonly ModuleDefinition[] = [
  authModule,
  companiesModule,
  financeModule,
  inventoryModule,
  logisticsModule,
  ordersModule,
  productsModule,
  usersModule,
  // 🔜 Append future modules here:
  // salesModule, purchasesModule,
  // reportsModule, aiModule,
];

/**
 * Auxiliary mounts — modules that need to expose a second router under a
 * different base path (e.g. legacy `/api/admin/*` namespaces). These are
 * mounted by `registerModules` and `registerV1Modules` alongside the canonical
 * ones; they are intentionally excluded from `V2_MODULES` because admin
 * endpoints retain the legacy non-envelope response shape.
 */
const AUX_MODULES: readonly ModuleDefinition[] = [
  categoriesModule,
  usersAdminModule,
];

/**
 * v2 modules — only modules that have a v2 controller implementing the full
 * `shared/utils/apiResponse` contract (ok/created/noContent/fail on every
 * response) should be listed here.
 *
 * Pilot: orders.  Next: users, companies, finance.
 */
const V2_MODULES: readonly ModuleDefinition[] = [
  { name: "orders", basePath: "/api/v2/orders", router: ordersRouterV2 },
  // 🔜 Add other modules as they gain v2 controllers:
  // { name: "users",     basePath: "/api/v2/users",     router: usersRouterV2     },
  // { name: "companies", basePath: "/api/v2/companies", router: companiesRouterV2 },
];

/**
 * Mount all modules at their canonical (unversioned) `/api/*` base paths.
 * Preserved for backward compatibility — the frontend and existing callers
 * continue to use `/api/orders`, `/api/users`, etc. indefinitely.
 */
export function registerModules(app: Express): void {
  for (const mod of MODULES) {
    app.use(mod.basePath, mod.router);
    console.log(`[modules] mounted '${mod.name}' at ${mod.basePath}`);
  }
  for (const mod of AUX_MODULES) {
    app.use(mod.basePath, mod.router);
    console.log(`[modules] mounted '${mod.name}' at ${mod.basePath}`);
  }
}

/**
 * Mount all modules at `/api/v1/*` — same router instances, zero code
 * duplication. Clients that prefer explicit versioning can pin to v1 knowing
 * the contract will never silently change.
 *
 * Derives v1 paths by replacing the `/api` prefix with `/api/v1`.
 */
export function registerV1Modules(app: Express): void {
  for (const mod of MODULES) {
    const v1Path = `/api/v1${mod.basePath.slice("/api".length)}`;
    app.use(v1Path, mod.router);
    console.log(`[modules] mounted '${mod.name}' at ${v1Path} (v1)`);
  }
  for (const mod of AUX_MODULES) {
    const v1Path = `/api/v1${mod.basePath.slice("/api".length)}`;
    app.use(v1Path, mod.router);
    console.log(`[modules] mounted '${mod.name}' at ${v1Path} (v1)`);
  }
}

/**
 * Mount v2 modules at `/api/v2/*`.
 *
 * v2 guarantees: every response uses ok/created/noContent/fail from
 * `shared/utils/apiResponse`, status codes follow REST conventions (204 for
 * DELETE, 201 for resource-creating POST), and the envelope shape is
 * `{ success: true, data }` / `{ success: false, error }` on every path.
 */
export function registerV2Modules(app: Express): void {
  for (const mod of V2_MODULES) {
    app.use(mod.basePath, mod.router);
    console.log(`[modules] mounted '${mod.name}' at ${mod.basePath} (v2)`);
  }
}
