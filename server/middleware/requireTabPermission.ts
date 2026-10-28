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
      // A GPS ping is a device telemetry operation, not access to the whole
      // driver panel. Keep the route's authentication, role, tenant and
      // ownership checks, but do not let an old UI tab override stop a
      // LOGISTICS/driver account from sending its own position.
      if (isTrackerGpsSubmission(req, user.role)) return next();
      const key = typeof tabKey === "function" ? tabKey(req) : tabKey;
      if (!tabPermissionAllows(user.tabPermissions, key, user.role)) return next(new ForbiddenError("Módulo não autorizado para este usuário"));
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function isTrackerGpsSubmission(req: Request, role: string): boolean {
  if (!["LOGISTICS", "MOTORISTA", "DRIVER"].includes(role)) return false;
  if (String(req.method ?? "").toUpperCase() !== "POST") return false;
  const path = String(req.originalUrl ?? req.path ?? "")
    .split("?", 1)[0]
    .replace(/\/+$/, "");
  return path === "/api/driver/gps" || path === "/gps";
}
