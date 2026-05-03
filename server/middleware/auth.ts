import { Request, Response, NextFunction } from 'express';

import { requireAuth as requireAuthCore, requireRole as requireRoleCore } from "../core/http/requireAuth";

export const requireAuth = requireAuthCore;

export function requireCompanyAuth(req: any, res: any, next: NextFunction) {
  return requireAuthCore(req, res, next);
}

export function requireAdminAuth(req: any, res: any, next: NextFunction) {
  return requireAuthCore(req, res, next);
}

export function tenantIsolation(req: any, _res: any, next: NextFunction) {
  const session = (req as any).session;
  if (session?.companyId) {
    req.empresaId = session.companyId;
  } else if (session?.userId) {
    req.empresaId = req.query.empresaId ? parseInt(req.query.empresaId as string) : null;
  }
  req.tenantFilter = req.empresaId ? { empresaId: req.empresaId } : {};
  next();
}

export function requireCompanyAccess(req: any, res: any, next: NextFunction) {
  return requireAuthCore(req, res, (err?: any) => {
    if (err || res.headersSent) return;
    tenantIsolation(req, res, next);
  });
}

export function requireAdminAccess(req: any, res: any, next: NextFunction) {
  return requireAuthCore(req, res, (err?: any) => {
    if (err || res.headersSent) return;
    tenantIsolation(req, res, next);
  });
}

export function validateResourceOwnership(resourceTable: string) {
  return async (_req: any, _res: any, next: NextFunction) => next();
}

export const requireRole = requireRoleCore;