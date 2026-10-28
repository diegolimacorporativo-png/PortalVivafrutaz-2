/** Canonical staff profiles. Keep assignment and route policies aligned. */
export const USER_ROLE_VALUES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
  "MANAGER", // legacy management profile still used by email administration routes
  "OPERATIONS_MANAGER",
  "PURCHASE_MANAGER",
  "FINANCEIRO",
  "LOGISTICS",
  "COMERCIAL",
  "MASTER_COMERCIAL",
  "MOTORISTA",
  "DRIVER", // legacy alias; normalized to MOTORISTA by the UI
  "NUTRICIONISTA",
  "SISTEMA_TESTE",
  "GESTOR_CONTRATOS",
] as const;

export type UserRole = (typeof USER_ROLE_VALUES)[number];

/** Explicit marker for a user who has disabled every configurable tab.
 * Empty arrays retain the legacy meaning of "use profile defaults". */
export const DENY_ALL_TAB_PERMISSIONS = "__deny_all_tabs__";

export const ACTION_PERMISSION_KEY = "actionOverridesV1";
export const ACTION_PERMISSION_MODULES = ["orders", "logistics", "quotations", "special-orders"] as const;
export const ACTION_PERMISSION_ACTIONS = ["read", "create", "edit", "delete"] as const;

export type ActionPermissionModule = (typeof ACTION_PERMISSION_MODULES)[number];
export type ActionPermissionAction = (typeof ACTION_PERMISSION_ACTIONS)[number];

/**
 * Existing `users.permissions` JSONB may contain opaque legacy data. Only the
 * namespaced v1 shape is interpreted; legacy keys remain untouched. A false
 * override denies an operation. A true override never replaces route roles.
 */
export function actionPermissionAllows(
  stored: unknown,
  module: ActionPermissionModule,
  action: ActionPermissionAction,
  role?: string | null,
): boolean {
  if (role && (FULL_SYSTEM_ACCESS_ROLES as readonly string[]).includes(role)) return true;
  if (stored == null || typeof stored !== "object" || Array.isArray(stored)) return true;
  const config = (stored as Record<string, unknown>)[ACTION_PERMISSION_KEY];
  if (config === undefined) return true;
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const moduleConfig = (config as Record<string, unknown>)[module];
  if (moduleConfig === undefined) return true;
  if (!moduleConfig || typeof moduleConfig !== "object" || Array.isArray(moduleConfig)) return false;
  const value = (moduleConfig as Record<string, unknown>)[action];
  return value === undefined || value === true;
}

export function tabPermissionAllows(permissions: unknown, tabKey: string, role?: string | null): boolean {
  if (role && (FULL_SYSTEM_ACCESS_ROLES as readonly string[]).includes(role)) return true;
  // Logistics monitoring is an operational capability explicitly assigned to
  // these profiles; legacy per-user tab lists must not hide the GPS screen.
  if (
    tabKey === "gps-tracking"
    && ["LOGISTICS", "COMERCIAL", "MASTER_COMERCIAL"].includes(role ?? "")
  ) return true;
  if (permissions == null || (Array.isArray(permissions) && permissions.length === 0)) return true;
  if (!Array.isArray(permissions) || !permissions.every((value) => typeof value === "string")) return false;
  if (permissions.includes(DENY_ALL_TAB_PERMISSIONS)) return false;
  return permissions.includes(tabKey);
}

/** Global platform administrators; their account must still be unbound for global data scope. */
export const GLOBAL_ADMIN_ROLES = ["MASTER", "DIRECTOR", "DEVELOPER"] as const;

/** Roles allowed to manage system users when their account has global scope. */
export const GLOBAL_USER_MANAGEMENT_ROLES = GLOBAL_ADMIN_ROLES;

/** Profiles that must retain access to all system modules regardless of per-user UI restrictions. */
export const FULL_SYSTEM_ACCESS_ROLES = ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"] as const;

/** Profiles whose unbound accounts can select any company for ordinary work. */
export const GLOBAL_SCOPE_ROLES = ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"] as const;

/** Internal Vivafrutaz staff profiles; distinct from company portal accounts. */
export const INTERNAL_STAFF_ROLES = ["COMERCIAL", "LOGISTICS"] as const;

/** Profiles permitted to target a company for cross-company operations. */
export const CROSS_COMPANY_STAFF_ROLES = [
  ...GLOBAL_SCOPE_ROLES, "COMERCIAL", "LOGISTICS",
] as const;

/** Tenant admins manage staff, but cannot grant platform/developer authority. */
export const TENANT_ASSIGNABLE_USER_ROLES = [
  "MANAGER",
  "OPERATIONS_MANAGER",
  "PURCHASE_MANAGER",
  "FINANCEIRO",
  "LOGISTICS",
  "COMERCIAL",
  "MASTER_COMERCIAL",
  "MOTORISTA",
  "DRIVER",
  "NUTRICIONISTA",
  "SISTEMA_TESTE",
  "GESTOR_CONTRATOS",
] as const;

export const USER_MANAGEMENT_ROLES = ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"] as const;
