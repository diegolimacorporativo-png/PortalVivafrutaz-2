import type { Express, Router } from "express";
import { definition as financeModule } from "./finance";

/**
 * Central module loader.
 *
 * Architecture decision: every module exports `{ name, basePath, router }`
 * from its `index.ts`. To add a new module you:
 *   1. Implement it under `server/modules/<name>/`.
 *   2. Import its `definition` here and append it to `MODULES`.
 *   3. Done — `registerModules(app)` mounts it at `definition.basePath`.
 *
 * Modules are mounted BEFORE the legacy `routes.ts` so that any path that has
 * been migrated takes precedence. Legacy routes that haven't been migrated
 * yet still respond from `routes.ts` — this is what lets us refactor
 * incrementally without breaking the running app.
 */
interface ModuleDefinition {
  readonly name: string;
  readonly basePath: string;
  readonly router: Router;
}

export const MODULES: readonly ModuleDefinition[] = [
  financeModule,
  // 🔜 Append future modules here as they are implemented:
  // authModule, usersModule, salesModule, inventoryModule,
  // purchasesModule, logisticsModule, reportsModule, aiModule,
];

export function registerModules(app: Express): void {
  for (const mod of MODULES) {
    app.use(mod.basePath, mod.router);
    console.log(`[modules] mounted '${mod.name}' at ${mod.basePath}`);
  }
}
