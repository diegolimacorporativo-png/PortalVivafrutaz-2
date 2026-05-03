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

export function resolveTenant(req: any) {
  const user = req.user;
  if (user?.role === "MASTER" || user?.role === "ADMIN" || user?.role === "DEVELOPER" || user?.role === "DIRECTOR") {
    return typeof req.query?.tenantId === "string" && req.query.tenantId.trim() ? req.query.tenantId.trim() : "GLOBAL_VIEW";
  }
  return user?.tenantId ?? user?.empresaId?.toString() ?? null;
}

export function requireTenantId(): number {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new UnauthorizedError("Tenant context ausente — esta operação exige autenticação tenant-scoped");
  }
  if (ctx.empresaId == null) {
    throw new ForbiddenError("Operação requer um tenant alvo. Admins devem informar ?empresaId=N");
  }
  return ctx.empresaId;
}

export function currentTenantId(): number | null {
  return storage.getStore()?.empresaId ?? null;
}

export function isAdmin(): boolean {
  return storage.getStore()?.principal.kind === "admin";
}
