import type { Request, Response, NextFunction } from "express";
import { UnauthorizedError } from "../errors";

/**
 * Placeholder authentication middleware.
 * Replace with full session/JWT check during migration.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const session = (req as any).session;
  if (!session?.userId && !session?.companyId) {
    return next(new UnauthorizedError());
  }
  next();
}
