import { ForbiddenError, UnauthorizedError } from "../../shared/errors/AppError";
import { getTenantContext } from "../../core/tenant/context";

// Keep the exact API role allowlist; selected company context does not narrow
// or widen the production read because this module is explicitly global.
export const PRODUCTION_ACCESS_ROLES = [
  "MASTER", "ADMIN", "DIRECTOR", "DEVELOPER", "OPERATIONS_MANAGER", "PURCHASE_MANAGER",
] as const;

export function assertProductionGlobalAccess(): void {
  const context = getTenantContext();
  if (!context) throw new UnauthorizedError("Autenticação necessária para consultar a Produção global");
  if (context.principal.kind !== "admin" || !PRODUCTION_ACCESS_ROLES.includes(context.principal.role as any)) {
    throw new ForbiddenError("Perfil não autorizado a acessar a Produção global");
  }
}
