import type { Request, Response, NextFunction } from "express";
import { UnauthorizedError, ForbiddenError } from "../errors/AppError";

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
 */
export function requireRole(allowed: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = (req as any).session?.userRole || (req as any).user?.role;
    if (!role || !allowed.includes(role)) {
      return next(new ForbiddenError("Sem permissão para esta operação"));
    }
    next();
  };
}
