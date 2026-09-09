import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { runWithTenant } from "../core/tenant/context";
import {
  requireAuth as requireAuthCore,
  requireRole,
  requireSession,
} from "../core/http/requireAuth";
import {
  extractRequestedCompanyId,
  resolveOrderExceptionAccess,
  sanitizeOrderExceptionBody,
} from "./order-exceptions.policy";

export function register(app: Express) {
  // Order Exceptions
  app.get(
    '/api/order-exceptions',
    requireAuthCore,
    requireRole(["MASTER", "ADMIN", "DIRECTOR"], { strict: true }),
    async (req: any, res, next) => {
      try {
        const actor = await storage.getUser(req.session.userId);
        if (!actor) {
          return res.status(403).json({ message: "Acesso negado" });
        }
        const access = resolveOrderExceptionAccess(actor ?? {});
        if (!access.allowed) {
          return res.status(access.status).json({ message: access.message });
        }

        const exceptions = await runWithTenant(
          {
            principal: {
              kind: "admin",
              empresaId: access.tenantId,
              userId: actor.id,
              role: actor.role,
            },
            empresaId: access.tenantId,
          },
          () => storage.getOrderExceptions(),
        );
        return res.json(exceptions);
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post(
    '/api/order-exceptions',
    requireAuthCore,
    requireRole(["MASTER", "ADMIN", "DIRECTOR"], { strict: true }),
    async (req: any, res, next) => {
      try {
        const actor = await storage.getUser(req.session.userId);
        if (!actor) {
          return res.status(403).json({ message: "Acesso negado" });
        }
        const requestedCompanyId = extractRequestedCompanyId(req.body);
        const access = resolveOrderExceptionAccess(actor, requestedCompanyId);
        if (!access.allowed) {
          return res.status(access.status).json({ message: access.message });
        }

        if (access.tenantId == null) {
          return res.status(400).json({ message: "companyId required" });
        }

        const body = sanitizeOrderExceptionBody(req.body);
        if (!body.reason) {
          return res.status(400).json({ message: "reason required" });
        }
        const expiryDate =
          body.expiryDate === undefined ||
          body.expiryDate === null ||
          body.expiryDate === ""
            ? null
            : String(body.expiryDate);
        const active = body.active === undefined ? true : Boolean(body.active);

        const exc = await runWithTenant(
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
            storage.createOrderException({
              companyId: access.tenantId!,
              reason: String(body.reason),
              expiryDate,
              active,
            }),
        );
        return res.status(201).json(exc);
      } catch (error) {
        return next(error);
      }
    },
  );

  app.put(
    '/api/order-exceptions/:id',
    requireAuthCore,
    requireRole(["MASTER", "ADMIN", "DIRECTOR"], { strict: true }),
    async (req: any, res, next) => {
      try {
        const actor = await storage.getUser(req.session.userId);
        if (!actor) {
          return res.status(403).json({ message: "Acesso negado" });
        }
        const access = resolveOrderExceptionAccess(actor ?? {});
        if (!access.allowed) {
          return res.status(access.status).json({ message: access.message });
        }

        const exc = await runWithTenant(
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
            storage.updateOrderException(
              Number(req.params.id),
              sanitizeOrderExceptionBody(req.body),
            ),
        );
        if (!exc) {
          return res.status(404).json({ message: "Exceção de pedido não encontrada" });
        }
        return res.json(exc);
      } catch (error) {
        return next(error);
      }
    },
  );

  app.delete(
    '/api/order-exceptions/:id',
    requireAuthCore,
    requireRole(["MASTER", "ADMIN", "DIRECTOR"], { strict: true }),
    async (req: any, res, next) => {
      try {
        const actor = await storage.getUser(req.session.userId);
        if (!actor) {
          return res.status(403).json({ message: "Acesso negado" });
        }
        const access = resolveOrderExceptionAccess(actor ?? {});
        if (!access.allowed) {
          return res.status(access.status).json({ message: access.message });
        }

        const deleted = await runWithTenant(
          {
            principal: {
              kind: "admin",
              empresaId: access.tenantId,
              userId: actor.id,
              role: actor.role,
            },
            empresaId: access.tenantId,
          },
          () => storage.deleteOrderException(Number(req.params.id)),
        );
        if (!deleted) {
          return res.status(404).json({ message: "Exceção de pedido não encontrada" });
        }
        return res.status(204).end();
      } catch (error) {
        return next(error);
      }
    },
  );

  // Check order exception for a company (used by client-side order check)
  app.get(
    '/api/order-exceptions/company/:companyId',
    requireSession,
    async (req: any, res, next) => {
      try {
        const companyId = Number(req.params.companyId);
        const session = req.session;

        if (session.companyId) {
          if (Number(session.companyId) !== companyId) {
            return res.status(404).json({ message: "Exceção de pedido não encontrada" });
          }
          const exc = await runWithTenant(
            {
              principal: {
                kind: "company",
                empresaId: Number(session.companyId),
                userId: session.userId,
              },
              empresaId: Number(session.companyId),
            },
            () => storage.getCompanyException(companyId),
          );
          return res.json(exc || null);
        }

        const actor = await storage.getUser(session.userId);
        if (!actor) {
          return res.status(403).json({ message: "Acesso negado" });
        }
        const access = resolveOrderExceptionAccess(actor, companyId);
        if (!access.allowed) {
          return res.status(access.status).json({ message: access.message });
        }

        const exc = await runWithTenant(
          {
            principal: {
              kind: "admin",
              empresaId: access.tenantId,
              userId: actor.id,
              role: actor.role,
            },
            empresaId: access.tenantId,
          },
          () => storage.getCompanyException(companyId),
        );
        return res.json(exc || null);
      } catch (error) {
        return next(error);
      }
    },
  );
}
