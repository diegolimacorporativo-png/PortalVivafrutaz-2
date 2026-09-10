import { AsyncLocalStorage } from "node:async_hooks";
import { ForbiddenError, UnauthorizedError } from "../../shared/errors/AppError";

export type TenantPrincipal =
  | { kind: "company"; empresaId: number; userId?: number }
  | { kind: "admin"; empresaId: number | null; userId: number; role?: string };

export interface TenantContext {
  principal: TenantPrincipal;
  empresaId: number | null;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Read the already-resolved tenant. Tenant resolution belongs to
 * `middleware/tenant.ts`, where the session user is loaded and the request
 * lifecycle is pinned with AsyncLocalStorage.
 *
 * This intentionally does not inspect `req.user`, query, headers, or body.
 * Those values are client-controlled (and the old implementation returned the
 * string `GLOBAL_VIEW`), so using them here could silently turn a missing
 * context into a global read.
 */
export function resolveTenant(_req?: unknown): number | null {
  return currentTenantId();
}

export function requireTenantId(): number {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new UnauthorizedError("Tenant context ausente — esta operação exige autenticação tenant-scoped");
  }
  if (ctx.empresaId == null) {
    throw new ForbiddenError("Operação requer um tenant alvo");
  }
  return ctx.empresaId;
}

export function currentTenantId(): number | null {
  return storage.getStore()?.empresaId ?? null;
}

export function isAdmin(): boolean {
  return storage.getStore()?.principal.kind === "admin";
}
