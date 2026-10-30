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
export const ACTION_PERMISSION_MODULES = ["orders", "logistics", "quotations", "special-orders", "finance"] as const;
export const ACTION_PERMISSION_ACTIONS = ["read", "create", "edit", "delete"] as const;

export type ActionPermissionModule = (typeof ACTION_PERMISSION_MODULES)[number];
export type ActionPermissionAction = (typeof ACTION_PERMISSION_ACTIONS)[number];

/** Frontend routes governed by the existing per-user action permission modules. */
export const ACTION_PERMISSION_TAB_MODULES: Readonly<Record<string, ActionPermissionModule>> = {
  orders: "orders",
  "special-orders": "special-orders",
  quotations: "quotations",
  logistics: "logistics",
  finance: "finance",
};

/** Every internal role may view GPS except sanitary and driver accounts. */
export const GPS_VIEW_ROLES = USER_ROLE_VALUES.filter(
  (role) => !["NUTRICIONISTA", "MOTORISTA", "DRIVER"].includes(role),
);

export function roleCanViewGps(role: string | null | undefined): boolean {
  return !!role && (GPS_VIEW_ROLES as readonly string[]).includes(role);
}

/**
 * Maximum operational capability by profile. `undefined` preserves existing
 * module-specific policies for roles not covered by the approved RBAC matrix.
 * Per-user configuration can only deny capabilities granted by this ceiling.
 */
export function roleActionAllows(
  role: string | null | undefined,
  module: ActionPermissionModule,
  action: ActionPermissionAction,
): boolean | undefined {
  if (!role || (FULL_SYSTEM_ACCESS_ROLES as readonly string[]).includes(role)) return true;
  const readOnly = action === "read";
  if (role === "COMERCIAL") {
    if (module === "logistics") return readOnly;
    if (["orders", "quotations", "special-orders"].includes(module)) return action !== "delete";
  }
  if (role === "LOGISTICS") {
    if (["orders", "quotations", "special-orders"].includes(module)) return readOnly;
    if (module === "logistics") return action !== "delete";
    if (module === "finance") return readOnly;
  }
  if (role === "FINANCEIRO") {
    if (["orders", "quotations", "special-orders", "logistics"].includes(module)) return readOnly;
    // Preserve the existing finance-role operation policy; custom settings
    // can restrict it, while existing service rules continue to authorize it.
    if (module === "finance") return true;
  }
  return undefined;
}

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
  const roleCeiling = roleActionAllows(role, module, action);
  if (roleCeiling === false) return false;
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
  const restrictedTabAccess: Record<string, readonly string[]> = {
    COMERCIAL: ["dashboard", "orders", "special-orders", "logistics", "quotations", "gps-tracking", "tasks", "incidents", "internal-incidents", "about-us", "treinamento", "settings"],
    LOGISTICS: ["dashboard", "orders", "special-orders", "logistics", "quotations", "gps-tracking", "tasks", "incidents", "internal-incidents", "about-us", "treinamento", "settings", "logistics-intelligence", "waste-control"],
    FINANCEIRO: ["dashboard", "orders", "special-orders", "logistics", "quotations", "gps-tracking", "financial", "finance", "fiscal", "fiscal-diagnostics", "nfe", "faturamento", "insert-nf-manual", "banco", "financial-intelligence", "tasks", "about-us", "treinamento", "settings", "executive"],
  };
  const roleTabs = role ? restrictedTabAccess[role] : undefined;
  if (roleTabs && !roleTabs.includes(tabKey)) return false;
  // GPS remains a profile capability ceiling, while an explicit per-user tab
  // list may restrict (but cannot grant) access to the monitoring module.
  if (tabKey === "gps-tracking" && role && !roleCanViewGps(role)) return false;
  if (permissions == null || (Array.isArray(permissions) && permissions.length === 0)) return true;
  if (!Array.isArray(permissions) || !permissions.every((value) => typeof value === "string")) return false;
  if (permissions.includes(DENY_ALL_TAB_PERMISSIONS)) return false;
  return permissions.includes(tabKey);
}

/** Global platform administrators; their account must still be unbound for global data scope. */
export const GLOBAL_ADMIN_ROLES = ["MASTER", "DIRECTOR", "DEVELOPER"] as const;

/** Roles allowed to manage system users when their account has global scope. */
export const GLOBAL_USER_MANAGEMENT_ROLES = [...GLOBAL_ADMIN_ROLES, "ADMIN"] as const;

/** Profiles that must retain access to all system modules regardless of per-user UI restrictions. */
export const FULL_SYSTEM_ACCESS_ROLES = ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"] as const;

/** Profiles whose unbound accounts can select any company for ordinary work. */
export const GLOBAL_SCOPE_ROLES = ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"] as const;

/** Every role in the users table is an internal staff identity; customer
 * portal accounts are stored separately in the companies table. */
export const INTERNAL_STAFF_ROLES = USER_ROLE_VALUES.filter(
  (role) => !(GLOBAL_SCOPE_ROLES as readonly string[]).includes(role),
);

/** Internal profiles may select an operational company per request. Driver
 * identities remain limited to their own driver/journey flow. */
export const CROSS_COMPANY_STAFF_ROLES = [
  ...GLOBAL_SCOPE_ROLES,
  ...INTERNAL_STAFF_ROLES.filter((role) => !["MOTORISTA", "DRIVER"].includes(role)),
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

/**
 * Profile assignment is an identity-management permission. It depends on the
 * authenticated manager role, never on the manager's selected or legacy
 * company association.
 */
export function canAssignInternalUserRole(
  managerRole: string | null | undefined,
  candidateRole: string,
): boolean {
  return !!managerRole &&
    (GLOBAL_USER_MANAGEMENT_ROLES as readonly string[]).includes(managerRole) &&
    (USER_ROLE_VALUES as readonly string[]).includes(candidateRole);
}
