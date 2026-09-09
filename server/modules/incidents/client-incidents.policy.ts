/**
 * Tenant policy shared by the client-incidents HTTP handlers and unit tests.
 *
 * A company session is always tenant-bound. An admin session is tenant-bound
 * when its request has a tenant selected by tenantContext; only the explicit
 * global roles may operate without one.
 */

export const CLIENT_INCIDENT_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
  "OPERATIONS_MANAGER",
  "LOGISTICS",
] as const;

export const CLIENT_INCIDENT_DELETE_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
] as const;

export const CLIENT_INCIDENT_GLOBAL_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
] as const;

export type ClientIncidentScope =
  | { companyId: number; global: false }
  | { companyId: null; global: true };

export type ClientIncidentPrincipal = {
  sessionCompanyId?: number | null;
  tenantId?: number | null;
  role?: string | null;
  userEmpresaId?: number | null;
};

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function hasClientIncidentRole(
  role: string | null | undefined,
  allowed: readonly string[] = CLIENT_INCIDENT_ROLES,
): boolean {
  return !!role && allowed.includes(role);
}

/**
 * Resolves the scope after tenantContext has pinned the request.
 * Returns null for an authenticated principal that is not allowed to use the
 * endpoint, or for a non-global admin without a tenant.
 */
export function resolveClientIncidentScope(
  principal: ClientIncidentPrincipal,
  allowed: readonly string[] = CLIENT_INCIDENT_ROLES,
): ClientIncidentScope | null {
  const companySessionId = positiveInteger(principal.sessionCompanyId);
  if (companySessionId != null) {
    return { companyId: companySessionId, global: false };
  }

  if (!hasClientIncidentRole(principal.role, allowed)) return null;

  const tenantId = positiveInteger(principal.tenantId);
  const userEmpresaId = positiveInteger(principal.userEmpresaId);
  if (userEmpresaId != null) {
    return tenantId === userEmpresaId
      ? { companyId: userEmpresaId, global: false }
      : null;
  }

  if (CLIENT_INCIDENT_GLOBAL_ROLES.includes(principal.role as any)) {
    if (tenantId != null) return { companyId: tenantId, global: false };
    return { companyId: null, global: true };
  }

  return null;
}

/**
 * Tenant-bound callers cannot choose a company. A global admin may target a
 * company explicitly for the existing cross-tenant administration flow.
 */
export function resolveIncidentCreationCompanyId(
  scope: ClientIncidentScope,
  requestedCompanyId: unknown,
): number | null {
  if (!scope.global) return scope.companyId;
  return positiveInteger(requestedCompanyId);
}

export function incidentBelongsToScope(
  scope: ClientIncidentScope,
  incidentCompanyId: unknown,
): boolean {
  if (scope.global) return true;
  return positiveInteger(incidentCompanyId) === scope.companyId;
}

/**
 * Only incident workflow fields are accepted by PATCH. Tenant identifiers and
 * arbitrary columns are deliberately discarded at the boundary.
 */
export function sanitizeIncidentPatch(input: unknown): {
  status?: string;
  adminNote?: string;
} {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const patch: { status?: string; adminNote?: string } = {};
  if (typeof body.status === "string") patch.status = body.status;
  if (typeof body.adminNote === "string") patch.adminNote = body.adminNote;
  return patch;
}