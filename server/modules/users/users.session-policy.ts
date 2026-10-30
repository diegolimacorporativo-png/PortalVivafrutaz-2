import type { InsertUser } from "./users.types";

const SESSION_INVALIDATING_FIELDS: readonly (keyof InsertUser)[] = [
  "role",
  "active",
  "isLocked",
  "empresaId",
  "tabPermissions",
  "permissions",
];

/** Revoke existing user sessions when persisted authorization changes. */
export function userUpdateRequiresSessionRevocation(
  updates: Partial<InsertUser> | Record<string, unknown>,
): boolean {
  return SESSION_INVALIDATING_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(updates, field),
  );
}
