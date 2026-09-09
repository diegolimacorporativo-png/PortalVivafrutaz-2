/**
 * Inventory authorization policy.
 *
 * These roles mirror the existing admin route/menu contract. The backend is
 * authoritative; hiding the page in the client is not an authorization check.
 */
export const INVENTORY_READ_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
  "PURCHASE_MANAGER",
] as const;

export const INVENTORY_WRITE_ROLES = INVENTORY_READ_ROLES;

export type InventoryRole =
  (typeof INVENTORY_READ_ROLES)[number];

export function hasInventoryRole(
  role: string | undefined,
  allowed: readonly string[] = INVENTORY_READ_ROLES,
): boolean {
  return !!role && allowed.includes(role);
}