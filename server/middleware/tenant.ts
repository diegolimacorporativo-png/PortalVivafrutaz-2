import type { Request, Response, NextFunction } from "express";
import { runWithTenant, type TenantPrincipal } from "../core/tenant/context";
import { UnauthorizedError, ForbiddenError } from "../shared/errors/AppError";
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

  // Service request — the caller proved possession of the internal API key
  // via `requireAuthOrService`. A service is never a global principal:
  // it must select exactly one tenant before any handler is reached.
  if (req.isService && !session?.userId && !session?.companyId) {
    let target: number | null;
    try {
      target = resolveClientTenant(req);
    } catch (error) {
      return next(error);
    }
    if (target == null) {
      return next(new ForbiddenError("Serviço deve informar um tenant alvo"));
    }
    const principal: TenantPrincipal = {
      kind: "admin",
      empresaId: target,
      userId: 0,
      role: "SERVICE",
    } as TenantPrincipal;
    (req as any).empresaId = target;
    return runWithTenant(
      { principal, empresaId: target },
      () => next(),
    );
  }

  // Company portal: the tenant is the company itself. No override possible.
  if (session?.companyId) {
    let clientTarget: number | null;
    try {
      clientTarget = resolveClientTenant(req);
    } catch (error) {
      return next(error);
    }
    if (clientTarget !== null && clientTarget !== session.companyId) {
      return next(new ForbiddenError("Tenant da sessão não pode ser substituído"));
    }
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
    const clientTarget = resolveClientTenant(req);
    if (clientTarget !== null && clientTarget !== user.empresaId) {
      throw new ForbiddenError("Tenant da sessão não pode ser substituído");
    }
    return { kind: "admin", empresaId: user.empresaId, userId, role: user.role };
  }

  // 2. Only explicitly global operator roles retain the global flow.
  // ADMIN/DEVELOPER without a company are not global by default.
  if (!["MASTER", "DIRECTOR"].includes(user.role)) {
    throw new ForbiddenError("Este perfil precisa de uma empresa vinculada");
  }
  const target = resolveClientTenant(req);
  return { kind: "admin", empresaId: target, userId, role: user.role };
}

/**
 * Client tenant selectors are valid only for an explicitly global flow.
 * Header and query must agree when both are present. Request bodies are never
 * consulted for tenant resolution.
 */
function resolveClientTenant(req: Request): number | null {
  const headerValue = req.header("X-Empresa-Id");
  const queryValue = req.query?.empresaId;
  const header = parseTenantSelector(headerValue);
  const query = parseTenantSelector(
    Array.isArray(queryValue) ? undefined : (queryValue as string | undefined),
  );

  if (headerValue != null && header == null) {
    throw new ForbiddenError("empresaId alvo inválido");
  }
  if (queryValue != null && query == null) {
    throw new ForbiddenError("empresaId alvo inválido");
  }
  if (header !== null && query !== null && header !== query) {
    throw new ForbiddenError("Seletores de tenant ambíguos");
  }
  return header ?? query;
}

function parseTenantSelector(value: unknown): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Hard-fails the request if no tenant is pinned. Use on routes that must NEVER
 * run cross-tenant — even for MASTER admins. Most write endpoints want this.
 */
export function requireTenant(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).empresaId == null) {
    return next(
      new ForbiddenError(
        "Este endpoint exige um tenant alvo",
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
