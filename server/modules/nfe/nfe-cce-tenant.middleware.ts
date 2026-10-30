import type { NextFunction, Request, Response } from "express";
import { GLOBAL_SCOPE_ROLES } from "@shared/user-roles";
import { currentTenantId, getTenantContext } from "../../core/tenant/context";
import { validateOrderTenant } from "../../core/security/tenantGuard";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../../shared/errors/AppError";
import { storage } from "../../services/storage";
import { requireAuth, requireRole } from "../../core/http/requireAuth";
import { tenantContext } from "../../middleware/tenant";
import { FISCAL_ROLES } from "../orders/orders.service";

type NfeCceAccessDependencies = {
  getNfeEmissao(id: number): Promise<any>;
  getNfeEmissaoForCompany(id: number, companyId: number): Promise<any>;
  validateOrderTenant(orderId: number): Promise<void>;
};

const defaultDependencies: NfeCceAccessDependencies = {
  getNfeEmissao: (id) => storage.getNfeEmissao(id),
  getNfeEmissaoForCompany: (id, companyId) => storage.getNfeEmissaoForCompany(id, companyId),
  validateOrderTenant,
};

/**
 * Loads a CC-e's NF-e only within the tenant already established by
 * tenantContext. Unpinned access is reserved for unbound global-scope roles.
 * The linked order is then checked through the shared tenant guard before the
 * history or fiscal transmission code can run.
 */
export function createNfeCceTenantMiddleware(
  dependencies: NfeCceAccessDependencies = defaultDependencies,
) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const context = getTenantContext();
      if (!context) throw new UnauthorizedError("Tenant context ausente");

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new NotFoundError("NF-e não encontrada");
      }

      const tenantId = currentTenantId();
      let nfe: any;
      if (tenantId != null) {
        nfe = await dependencies.getNfeEmissaoForCompany(id, tenantId);
      } else {
        const principal = context.principal;
        const globallyAuthorized = principal.kind === "admin" &&
          (GLOBAL_SCOPE_ROLES as readonly string[]).includes(principal.role ?? "");
        if (!globallyAuthorized) {
          throw new ForbiddenError("Operação requer um tenant alvo");
        }
        nfe = await dependencies.getNfeEmissao(id);
      }

      if (!nfe) throw new NotFoundError("NF-e não encontrada");
      if (!Number.isInteger(Number(nfe.orderId)) || Number(nfe.orderId) <= 0) {
        throw new ForbiddenError("NF-e sem pedido associado — acesso negado");
      }

      await dependencies.validateOrderTenant(Number(nfe.orderId));
      (req as any).authorizedCceNfe = nfe;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const nfeCceTenantMiddleware = createNfeCceTenantMiddleware();

/** Shared exact middleware chains used by both legacy CC-e endpoints. */
export const nfeCceReadAccess = [
  requireAuth,
  requireRole([...FISCAL_ROLES]),
  tenantContext,
  nfeCceTenantMiddleware,
] as const;
export const nfeCceWriteAccess = [
  requireAuth,
  tenantContext,
  requireRole([...FISCAL_ROLES]),
  nfeCceTenantMiddleware,
] as const;
