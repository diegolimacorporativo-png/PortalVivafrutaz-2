import type { Request, Response, NextFunction } from "express";
import { storage } from "../services/storage";
import { ForbiddenError, UnauthorizedError } from "../shared/errors/AppError";
import {
  actionPermissionAllows,
  type ActionPermissionAction,
  type ActionPermissionModule,
} from "@shared/user-roles";

function actionForRequest(
  method: string,
  path: string,
  module: ActionPermissionModule,
): ActionPermissionAction | null {
  // GPS ingestion is telemetry from the authenticated driver's own device,
  // not a user-created logistics record. The route itself still enforces
  // login, an allowed role, and ownership of the driver's operational link.
  const normalizedPath = path.split("?", 1)[0].replace(/\/+$/, "") || "/";
  if (
    module === "logistics"
    && method.toUpperCase() === "POST"
    && normalizedPath === "/api/driver/gps"
  ) return null;

  switch (method.toUpperCase()) {
    case "GET":
    case "HEAD": return "read";
    case "POST": {
      const pathname = path.split("?", 1)[0].replace(/\/+$/, "") || "/";
      if (module === "orders" && /\/orders\/\d+\/substitute-item$/.test(pathname)) return "edit";
      if (module === "orders" && /\/orders\/reopen-requests\/\d+\/(approve|deny|finalize)$/.test(pathname)) return "edit";
      if (module === "logistics") {
        if (/\/api\/logistics\/(suggest-route|simulate-day|calculate-distance|route-assistant|smart-search|best-driver|smart-route-plan|day-orders)$/.test(pathname)) return "read";
        if (/\/api\/driver\/journey\/end$/.test(pathname)) return "edit";
        if (/\/api\/logistics\/routes\/\d+(\/stops\/\d+)?$/.test(pathname)) return "edit";
        if (/\/api\/deliveries\/\d+\/(status|complete)$/.test(pathname)) return "edit";
      }
      return "create";
    }
    case "PUT":
    case "PATCH": return "edit";
    case "DELETE": return "delete";
    default: return null;
  }
}

/**
 * Applies only explicit per-user denials stored in users.permissions JSONB.
 * Existing route-role, tenant and operation checks remain authoritative.
 * Company portal sessions keep their separate authorization flow.
 */
export function requireActionPermission(module: ActionPermissionModule) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const session = (req as any).session;
    if (!session?.userId) return next();
    const action = actionForRequest(req.method, req.originalUrl || req.path || "", module);
    if (!action) return next();

    try {
      const user = await storage.getUser(session.userId);
      if (!user || user.active === false) return next(new UnauthorizedError());
      const requestPath = (req.originalUrl || req.path || "").split("?", 1)[0].replace(/\/+$/, "");
      const isLogisticsGpsRead = user.role === "LOGISTICS" && module === "logistics" && action === "read" && (
        requestPath === "/api/logistics/drivers/gps" || /^\/api\/driver\/\d+\/gps$/.test(requestPath)
      );
      if (!isLogisticsGpsRead && !actionPermissionAllows(user.permissions, module, action, user.role)) {
        return next(new ForbiddenError("Ação não autorizada para este usuário"));
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
