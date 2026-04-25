import type { Request, Response, NextFunction } from "express";
import { runWithTenant, type TenantPrincipal } from "../core/tenant/context";
import { UnauthorizedError, ForbiddenError } from "../core/errors/AppError";
import { storage } from "../services/storage";

/**
 * Tenant middleware — the single place where the authenticated session is
 * resolved into a tenant identity and pinned to the request lifecycle via
 * AsyncLocalStorage.
 *
 * Architecture decision:
 *   1. Resolution happens once, at the HTTP boundary. Repositories never
 *      look at `req` to figure out the tenant — they call `requireTenantId()`
 *      from the context module.
 *   2. The chosen empresaId is FORCED by the session, never trusted from the
 *      request body/query (except for admins explicitly targeting a tenant).
 *      A logged-in company cannot smuggle `?empresaId=99` and read another
 *      tenant's data — the request body is irrelevant to scoping.
 *   3. The middleware runs `next()` *inside* the AsyncLocalStorage scope,
 *      so every async hop spawned during the request inherits the context.
 */

export function tenantContext(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;

  // Company portal: the tenant is the company itself. No override possible.
  if (session?.companyId) {
    const principal: TenantPrincipal = {
      kind: "company",
      empresaId: session.companyId,
      userId: session.userId,
    };
    (req as any).empresaId = session.companyId;
    if (session.userId) (req as any).userId = session.userId;
    return runWithTenant(
      { principal, empresaId: session.companyId },
      () => next(),
    );
  }

  // Admin portal: tenant comes from the user's empresaId. Cross-tenant admins
  // (empresaId == null on the user record) MAY target a specific tenant via
  // the X-Empresa-Id header or ?empresaId=N — useful for support staff.
  if (session?.userId) {
    return resolveAdminTenant(req, session.userId)
      .then((principal) => {
        (req as any).empresaId = principal.empresaId;
        runWithTenant(
          { principal, empresaId: principal.empresaId },
          () => next(),
        );
      })
      .catch(next);
  }

  return next(new UnauthorizedError());
}

async function resolveAdminTenant(
  req: Request,
  userId: number,
): Promise<TenantPrincipal> {
  const user = await storage.getUser(userId);
  if (!user) throw new UnauthorizedError("Sessão inválida");

  // 1. Admin pinned to a tenant — no override allowed.
  if (user.empresaId != null) {
    return { kind: "admin", empresaId: user.empresaId, userId, role: user.role };
  }

  // 2. Cross-tenant admin (e.g. MASTER) — may target a tenant per request.
  const headerVal =
    (req.header("X-Empresa-Id") as string | undefined) ??
    (req.query.empresaId as string | undefined);
  const target = headerVal ? Number(headerVal) : null;
  if (target != null && (!Number.isInteger(target) || target <= 0)) {
    throw new ForbiddenError("empresaId alvo inválido");
  }
  return { kind: "admin", empresaId: target, userId, role: user.role };
}

/**
 * Hard-fails the request if no tenant is pinned. Use on routes that must NEVER
 * run cross-tenant — even for MASTER admins. Most write endpoints want this.
 */
export function requireTenant(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).empresaId == null) {
    return next(
      new ForbiddenError(
        "Este endpoint exige um tenant alvo (informe ?empresaId=N ou faça login no portal da empresa)",
      ),
    );
  }
  next();
}

/**
 * Convenience: requires an authenticated session AND a pinned tenant. The
 * common case for tenant-scoped APIs.
 */
export function withTenantScope(req: Request, res: Response, next: NextFunction) {
  return tenantContext(req, res, (err?: any) => {
    if (err) return next(err);
    return requireTenant(req, res, next);
  });
}
