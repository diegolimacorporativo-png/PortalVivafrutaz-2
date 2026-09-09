/**
 * Tenant and authorization policy for special-order requests.
 *
 * The customer form is not public: it is tied to a company session. The
 * administrative list may be tenant-scoped or global only for the explicit
 * global roles below.
 */

export const SPECIAL_ORDER_VIEW_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
  "OPERATIONS_MANAGER",
  "LOGISTICS",
] as const;

export const SPECIAL_ORDER_MANAGE_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
] as const;

export const SPECIAL_ORDER_GLOBAL_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
] as const;

export type SpecialOrderScope =
  | { companyId: number; global: false }
  | { companyId: null; global: true };

export type SpecialOrderPrincipal = {
  sessionCompanyId?: number | null;
  tenantId?: number | null;
  userEmpresaId?: number | null;
  role?: string | null;
};

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolveSpecialOrderScope(
  principal: SpecialOrderPrincipal,
  allowedRoles: readonly string[] = SPECIAL_ORDER_VIEW_ROLES,
): SpecialOrderScope | null {
  const sessionCompanyId = positiveInteger(principal.sessionCompanyId);
  if (sessionCompanyId != null) {
    return { companyId: sessionCompanyId, global: false };
  }

  if (!principal.role || !allowedRoles.includes(principal.role)) return null;

  const tenantId = positiveInteger(principal.tenantId);
  const userEmpresaId = positiveInteger(principal.userEmpresaId);
  if (userEmpresaId != null) {
    return tenantId === userEmpresaId
      ? { companyId: userEmpresaId, global: false }
      : null;
  }

  if (SPECIAL_ORDER_GLOBAL_ROLES.includes(principal.role as any)) {
    return tenantId != null
      ? { companyId: tenantId, global: false }
      : { companyId: null, global: true };
  }

  return null;
}

/**
 * The company form must use the authenticated company session. Its body
 * companyId is intentionally not part of this decision.
 */
export function resolveSpecialOrderCreationCompanyId(
  sessionCompanyId: unknown,
  _requestedCompanyId: unknown,
): number | null {
  return positiveInteger(sessionCompanyId);
}

export function specialOrderBelongsToScope(
  scope: SpecialOrderScope,
  requestCompanyId: unknown,
): boolean {
  if (scope.global) return true;
  return positiveInteger(requestCompanyId) === scope.companyId;
}