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
 * Restrict an endpoint to a set of roles. Composes after requireAuth.
 * Usage: router.delete('/:id', requireAuth, requireRole(['ADMIN', 'DIRECTOR']), handler)
 *
 * Resolution: prefers `session.userRole` (cached at login by auth.controller).
 * Falls back to a DB lookup if the session predates the cache field — this
 * keeps long-lived sessions working across the rollout. The looked-up role
 * is then written back into the session so subsequent requests are fast.
 * Company-portal sessions (no userId) cannot satisfy any role check.
 */
export function requireRole(allowed: string[]) {
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
    const FULL_ACCESS_ROLES = ['MASTER', 'ADMIN', 'DIRECTOR'];
    if (!role || (!FULL_ACCESS_ROLES.includes(role) && !allowed.includes(role))) {
      return next(new ForbiddenError("Sem permissão para esta operação"));
    }
    next();
  };
}
