import type { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "../errors";

/**
 * Placeholder role-guard middleware factory.
 * Replace with full role resolution during migration.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const userRole = (req as any).session?.role as string | undefined;
    if (!userRole || !roles.includes(userRole)) {
      return next(new ForbiddenError());
    }
    next();
  };
}
