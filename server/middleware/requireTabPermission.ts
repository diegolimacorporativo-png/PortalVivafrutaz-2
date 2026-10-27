import type { Request, Response, NextFunction } from "express";
import { storage } from "../services/storage";
import { ForbiddenError, UnauthorizedError } from "../shared/errors/AppError";
import { tabPermissionAllows } from "@shared/user-roles";

/**
 * Applies the existing per-user tab restriction to APIs as a deny-only gate.
 * Role/action policies remain authoritative; a tab grant never grants a role.
 * `null` and legacy empty arrays mean profile defaults; an explicit marker
 * represents a user who disabled every configurable tab.
 */
export function requireTabPermission(tabKey: string | ((req: Request) => string)) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const session = (req as any).session;
    if (!session?.userId) return next(); // company and public routes keep their own gates

    try {
      const user = await storage.getUser(session.userId);
      if (!user || user.active === false) return next(new UnauthorizedError());
      const key = typeof tabKey === "function" ? tabKey(req) : tabKey;
      if (!tabPermissionAllows(user.tabPermissions, key)) return next(new ForbiddenError("Módulo não autorizado para este usuário"));
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
