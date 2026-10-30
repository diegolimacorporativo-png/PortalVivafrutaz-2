import { Router } from "express";
import { asyncHandler } from "../../core/http/asyncHandler";
import { requireAuth, requireRole } from "../../core/http/requireAuth";
import { GLOBAL_ADMIN_ROLES } from "@shared/user-roles";
import { securityController } from "./security.controller";

export const securityRouter = Router();

securityRouter.get(
  "/resumo",
  requireAuth,
  requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"]),
  asyncHandler((req, res) => securityController.resumo(req, res)),
);

securityRouter.get(
  "/tenant-mismatch-events",
  requireAuth,
  requireRole([...GLOBAL_ADMIN_ROLES], { strict: true }),
  asyncHandler((req, res) => securityController.tenantMismatchEvents(req, res)),
);
