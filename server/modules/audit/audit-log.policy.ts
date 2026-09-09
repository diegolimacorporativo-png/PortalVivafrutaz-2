/**
 * Policy for the legacy system_logs endpoints.
 *
 * This module contains no database or HTTP dependencies so the tenant/RBAC
 * decisions can be exercised with fakes. A null tenant is global only for an
 * unpinned MASTER or DIRECTOR; every other actor without a tenant fails closed.
 */

export type AuditActor = {
  role?: string | null;
  empresaId?: number | null;
};

export type AuditScope =
  | { kind: "global"; companyId?: number }
  | { kind: "tenant"; companyId: number };

const AUDIT_ROLES = ["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"] as const;
const GLOBAL_AUDIT_ROLES = ["MASTER", "DIRECTOR"] as const;
const MANUAL_CLIENT_ACTIONS = new Set([
  "FRONTEND_RUNTIME_ERROR",
  "FRONTEND_ERROR",
]);

export function canAccessAuditLogs(actor: AuditActor | null | undefined): boolean {
  return !!actor?.role && AUDIT_ROLES.includes(actor.role as (typeof AUDIT_ROLES)[number]);
}

export function canManageAuditLogs(actor: AuditActor | null | undefined): boolean {
  return canAccessAuditLogs(actor);
}

/**
 * Tenant-bound actors cannot override their tenant with any query parameter.
 * An unpinned MASTER/DIRECTOR retains the existing global behavior and may
 * optionally narrow a read/delete to one explicitly requested company.
 */
export function resolveAuditScope(
  actor: AuditActor | null | undefined,
  requestedCompanyId?: number,
): AuditScope | null {
  if (!canAccessAuditLogs(actor)) return null;

  if (
    GLOBAL_AUDIT_ROLES.includes(actor!.role as (typeof GLOBAL_AUDIT_ROLES)[number]) &&
    actor!.empresaId == null
  ) {
    return requestedCompanyId == null
      ? { kind: "global" }
      : { kind: "global", companyId: requestedCompanyId };
  }

  if (actor!.empresaId != null && Number.isInteger(actor!.empresaId) && actor!.empresaId > 0) {
    return { kind: "tenant", companyId: actor!.empresaId };
  }

  // ADMIN/DEVELOPER without a tenant, and any future role not explicitly
  // covered above, must not silently receive global visibility.
  return null;
}

export function parseRequestedCompanyId(query: Record<string, unknown>): number | undefined {
  const raw = query.companyId ?? query.empresaId ?? query.tenantId;
  if (raw == null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function isValidManualClientAction(action: unknown): action is string {
  return typeof action === "string" && MANUAL_CLIENT_ACTIONS.has(action);
}

export function sanitizeManualClientLog(body: Record<string, unknown>) {
  const action = body.action;
  const description = body.description;
  const level = body.level;
  if (!isValidManualClientAction(action) || typeof description !== "string" || !description.trim()) {
    return null;
  }

  return {
    action,
    description: description.slice(0, 1000),
    level: level === "WARN" || level === "ERROR" ? level : "INFO",
  } as const;
}