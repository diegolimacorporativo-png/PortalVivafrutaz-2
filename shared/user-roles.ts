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

/** MASTER and DIRECTOR have identical global administration authority. */
export const GLOBAL_ADMIN_ROLES = ["MASTER", "DIRECTOR"] as const;

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

export const USER_MANAGEMENT_ROLES = ["MASTER", "ADMIN", "DIRECTOR"] as const;
