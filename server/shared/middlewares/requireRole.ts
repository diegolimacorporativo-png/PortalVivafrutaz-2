import type { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "../errors";

/**
 * Placeholder role-guard middleware factory.
 * Replace with full role resolution during migration.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Session stores the role under `userRole` (set by auth controller at login).
    // Previously this used `session.role` which is never set → always undefined → always 403.
    const userRole = (req as any).session?.userRole as string | undefined;
    const FULL_ACCESS_ROLES = ['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'];
    if (!userRole || (!FULL_ACCESS_ROLES.includes(userRole) && !roles.includes(userRole))) {
      return next(new ForbiddenError());
    }
    next();
  };
}
