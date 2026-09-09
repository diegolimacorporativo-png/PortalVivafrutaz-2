import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import { runWithTenant } from "../core/tenant/context";
import { companiesRepository } from "../modules/companies/companies.repository";
import {
  EMPRESA_CONFIG_ROLES,
  resolveEmpresaConfigAccess,
  sanitizeEmpresaConfigBody,
} from "./empresa-config.policy";

export function register(app: Express) {
  app.get('/api/empresa-config/:empresaId', requireAuthCore, async (req: any, res, next) => {
    const actor = await storage.getUser(req.session.userId);
    const empresaId = Number(req.params.empresaId);
    const access = resolveEmpresaConfigAccess(actor ?? {}, empresaId);
    if (!access.allowed) {
      return res.status(access.status).json({ message: access.message });
    }

    if (!actor || !EMPRESA_CONFIG_ROLES.includes(actor.role as any)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    try {
      const cfg = await runWithTenant(
        {
          principal: {
            kind: "admin",
            empresaId: access.tenantId,
            userId: actor.id,
            role: actor.role,
          },
          empresaId: access.tenantId,
        },
        () => companiesRepository.getEmpresaConfig(empresaId),
      );
      return res.json(cfg ?? null);
    } catch (error) {
      return next(error);
    }
  });

  app.put('/api/empresa-config/:empresaId', requireAuthCore, async (req: any, res, next) => {
    const actor = await storage.getUser(req.session.userId);
    const empresaId = Number(req.params.empresaId);
    const access = resolveEmpresaConfigAccess(actor ?? {}, empresaId);
    if (!access.allowed) {
      return res.status(access.status).json({ message: access.message });
    }

    if (!actor || !EMPRESA_CONFIG_ROLES.includes(actor.role as any)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    try {
      const cfg = await runWithTenant(
        {
          principal: {
            kind: "admin",
            empresaId: access.tenantId,
            userId: actor.id,
            role: actor.role,
          },
          empresaId: access.tenantId,
        },
        () =>
          companiesRepository.upsertEmpresaConfig(
            empresaId,
            sanitizeEmpresaConfigBody(req.body),
          ),
      );
      return res.json(cfg);
    } catch (error) {
      return next(error);
    }
  });
}
