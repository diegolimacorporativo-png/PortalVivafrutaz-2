import type { Request, Response, NextFunction } from "express";
import { UnauthorizedError, ForbiddenError } from "../../shared/errors/AppError";
import { storage } from "../../services/storage";

/**
 * Auth middleware — replaces the inline `if (!req.session?.userId)` checks
 * scattered across the legacy routes. By centralizing the check we guarantee
 * a consistent 401 shape and make role-based authorization composable.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (!session?.userId) {
    return next(new UnauthorizedError());
  }
  (req as any).userId = session.userId;
  next();
}

/**
 * Session guard — accepts any authenticated session (admin userId OR company
 * companyId). Use this on endpoints accessible to both staff and portal users.
 * Distinct from requireAuth which only passes admin sessions (userId present).
 *
 * CONTENÇÃO F1-E2/E3: added to close public GET endpoints that were
 * reachable without any session. Does not alter response shape or business
 * logic — purely an authentication gate.
 */
export function requireSession(req: Request, _res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (!session?.userId && !session?.companyId) {
    return next(new UnauthorizedError());
  }
  next();
}

/**
 * Restrict an endpoint to a set of roles. Composes after requireAuth.
 * Usage: router.delete('/:id', requireAuth, requireRole(['ADMIN', 'DIRECTOR']), handler)
 *
 * Resolution: prefers `session.userRole` (cached at login by auth.controller).
 * Falls back to a DB lookup if the session predates the cache field — this
 * keeps long-lived sessions working across the rollout. The looked-up role
 * is then written back into the session so subsequent requests are fast.
 * Company-portal sessions (no userId) cannot satisfy any role check.
 *
 * opts.strict — when true, disables the FULL_ACCESS_ROLES bypass and checks
 * exclusively against the `allowed` list. Use on cross-tenant endpoints where
 * ADMIN/DIRECTOR must be explicitly excluded (e.g. executive-dashboard).
 * FASE MT-3A (C3): added strict mode to close the FULL_ACCESS_ROLES bypass.
 */
export function requireRole(allowed: string[], opts?: { strict?: boolean }) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const session = (req as any).session;
    let role: string | undefined = session?.userRole;
    if (!role && session?.userId) {
      try {
        const user = await storage.getUser(session.userId);
        if (user?.role) {
          role = user.role;
          session.userRole = role; // cache for subsequent requests
        }
      } catch {
        /* fall through — treated as missing role */
      }
    }
    // FULL_ACCESS_ROLES: strategic accounts bypass per-endpoint role requirements
    // unless the endpoint uses strict mode. DEVELOPER added per HOTFIX protocol.
    const FULL_ACCESS_ROLES = ['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'];
    const passes = opts?.strict
      ? (!!role && allowed.includes(role))
      : (!!role && (FULL_ACCESS_ROLES.includes(role) || allowed.includes(role)));
    if (!passes) {
      return next(new ForbiddenError("Sem permissão para esta operação"));
    }
    next();
  };
}
