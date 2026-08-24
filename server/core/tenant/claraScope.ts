import type { User } from "@shared/schema";

/**
 * Clara resolves data in one of two ways:
 * - a tenant pinned by tenantContext;
 * - a global scope reserved for MASTER/ADMIN without a tenant selection.
 *
 * Other staff roles can use Clara inside their assigned tenant, but an
 * unassigned session must never silently become a global read.
 */
export const CLARA_INTERNAL_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
] as const;

export const CLARA_GLOBAL_ROLES = ["MASTER", "ADMIN"] as const;

export function isClaraInternalRole(role: string | null | undefined): boolean {
  return !!role && (CLARA_INTERNAL_ROLES as readonly string[]).includes(role);
}

export function canUseGlobalClaraData(
  user: Pick<User, "role"> | null | undefined,
): boolean {
  return !!user && (CLARA_GLOBAL_ROLES as readonly string[]).includes(user.role);
}

export function resolveClaraDataScope(
  user: Pick<User, "role"> | null | undefined,
  tenantId: number | null,
  companyId?: number | null,
) {
  const resolvedTenantId = tenantId ?? companyId ?? null;
  const isGlobal = resolvedTenantId == null && canUseGlobalClaraData(user);
  return {
    tenantId: resolvedTenantId,
    isGlobal,
    canReadErp: resolvedTenantId != null || isGlobal,
  };
}