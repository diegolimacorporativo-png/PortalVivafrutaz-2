import { AsyncLocalStorage } from "node:async_hooks";
import { ForbiddenError, UnauthorizedError } from "../errors/AppError";

/**
 * TenantContext — request-scoped multi-tenant identity carried implicitly
 * through AsyncLocalStorage.
 *
 * Architecture decision: passing `empresaId` as an explicit parameter through
 * every service/repository call is brittle — a single forgotten argument
 * silently leaks data across tenants. Instead we install the tenant context
 * once, at the HTTP boundary, and any code path that hits the database asks
 * for it via `requireTenantId()`. If no context is installed (e.g. a worker
 * forgot to wrap its job, or a public route was accidentally tenant-scoped),
 * the call throws — failure is loud, not silent.
 *
 * The context distinguishes two principals:
 *   - "company": a tenant user logged in via the client portal. Pinned to a
 *     single empresaId; cross-tenant reads are impossible.
 *   - "admin":   an internal staff user. May target a specific tenant via
 *     ?empresaId=N or be a true cross-tenant operator (rare; gated by role).
 */
export type TenantPrincipal =
  | { kind: "company"; empresaId: number; userId?: number }
  | { kind: "admin"; empresaId: number | null; userId: number; role?: string };

export interface TenantContext {
  principal: TenantPrincipal;
  /**
   * The effective tenant id for this request. `null` only for admin requests
   * that have explicitly opted into cross-tenant scope. All write paths and
   * tenant-scoped reads MUST call `requireTenantId()` instead of reading this
   * directly.
   */
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
 * Returns the tenant id, or throws. Use this everywhere a query touches a
 * tenant-scoped table. If no context exists at all the caller is outside the
 * request lifecycle (a bug); if the context is admin-without-target we refuse
 * rather than silently falling back to "all tenants".
 */
export function requireTenantId(): number {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new UnauthorizedError(
      "Tenant context ausente — esta operação exige autenticação tenant-scoped",
    );
  }
  if (ctx.empresaId == null) {
    throw new ForbiddenError(
      "Operação requer um tenant alvo. Admins devem informar ?empresaId=N",
    );
  }
  return ctx.empresaId;
}

/**
 * Read the tenant id without throwing. Useful for code paths that legitimately
 * support both tenant-scoped and cross-tenant operation (e.g. an admin
 * dashboard aggregator). Returns `null` for admin-cross-tenant requests.
 */
export function currentTenantId(): number | null {
  return storage.getStore()?.empresaId ?? null;
}

export function isAdmin(): boolean {
  return storage.getStore()?.principal.kind === "admin";
}
