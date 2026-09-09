/**
 * Authorization and tenant rules for internal incidents.
 *
 * Internal incidents are staff-only. A user bound to a company can only
 * operate on that company's rows. Global staff may list globally, or become
 * tenant-bound when tenantContext selects a company for the request.
 */

export const INTERNAL_INCIDENT_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
  "OPERATIONS_MANAGER",
  "LOGISTICS",
] as const;

export const INTERNAL_INCIDENT_DELETE_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
] as const;

export const INTERNAL_INCIDENT_GLOBAL_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
] as const;

export type InternalIncidentScope =
  | { companyId: number; global: false }
  | { companyId: null; global: true };

export type InternalIncidentPrincipal = {
  tenantId?: number | null;
  role?: string | null;
  userEmpresaId?: number | null;
};

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function hasInternalIncidentRole(
  role: string | null | undefined,
  allowed: readonly string[] = INTERNAL_INCIDENT_ROLES,
): boolean {
  return !!role && allowed.includes(role);
}

export function resolveInternalIncidentScope(
  principal: InternalIncidentPrincipal,
  allowed: readonly string[] = INTERNAL_INCIDENT_ROLES,
): InternalIncidentScope | null {
  if (!hasInternalIncidentRole(principal.role, allowed)) return null;

  const tenantId = positiveInteger(principal.tenantId);
  const userEmpresaId = positiveInteger(principal.userEmpresaId);

  if (userEmpresaId != null) {
    return tenantId === userEmpresaId
      ? { companyId: userEmpresaId, global: false }
      : null;
  }

  if (INTERNAL_INCIDENT_GLOBAL_ROLES.includes(principal.role as any)) {
    return tenantId != null
      ? { companyId: tenantId, global: false }
      : { companyId: null, global: true };
  }

  return null;
}

export function internalIncidentBelongsToScope(
  scope: InternalIncidentScope,
  incidentCompanyId: unknown,
): boolean {
  if (scope.global) return true;
  return positiveInteger(incidentCompanyId) === scope.companyId;
}

/**
 * Writes must always have a concrete tenant. Global list access must not be
 * reused for create/update/delete.
 */
export function requiresInternalIncidentTenant(
  scope: InternalIncidentScope,
): scope is { companyId: number; global: false } {
  return scope.companyId != null;
}

/**
 * An assignee is a tenant-owned user. Global users without empresaId are not
 * valid assignees for a tenant incident.
 */
export function internalIncidentAssigneeBelongsToScope(
  scope: InternalIncidentScope,
  assigneeEmpresaId: unknown,
): boolean {
  return !scope.global && positiveInteger(assigneeEmpresaId) === scope.companyId;
}

/**
 * Only workflow fields can be changed. The assignee name is always resolved
 * from the selected user server-side and tenant identifiers are discarded.
 */
export function sanitizeInternalIncidentPatch(input: unknown): {
  status?: string;
  adminNote?: string;
  assignedToId?: number | null;
} {
  const body = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const patch: {
    status?: string;
    adminNote?: string;
    assignedToId?: number | null;
  } = {};

  if (typeof body.status === "string") patch.status = body.status;
  if (typeof body.adminNote === "string") patch.adminNote = body.adminNote;

  if (body.assignedToId === null || body.assignedToId === "" || body.assignedToId === "none") {
    patch.assignedToId = null;
  } else if (body.assignedToId !== undefined) {
    const assignedToId = positiveInteger(body.assignedToId);
    if (assignedToId != null) patch.assignedToId = assignedToId;
  }

  return patch;
}