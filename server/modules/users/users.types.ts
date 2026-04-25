/**
 * Users module — public type contracts.
 *
 * Architecture decision: same convention as the finance module — re-export the
 * Drizzle types we need and add module-specific DTOs. Consumers import only
 * from this barrel, never from `@shared/schema` directly, so the module's
 * surface area stays explicit and refactor-friendly.
 */
export type { User, InsertUser } from "@shared/schema";

import type { User } from "@shared/schema";

/**
 * SafeUser — User with the password field masked. Returned by every endpoint
 * that ships user data over the wire so the bcrypt hash never leaves the
 * server. The shape matches the legacy `{ ...u, password: '***' }` pattern.
 */
export type SafeUser = Omit<User, "password"> & { password: "***" };

export interface UserListFilter {
  /** Reserved for future filters (role, active, empresaId). Kept for parity. */
}

/**
 * Inputs for the privileged password-change endpoint. Kept distinct from the
 * generic `updateUser` payload so the audit-log call site stays explicit.
 */
export interface ChangePasswordInput {
  targetUserId: number;
  newPassword: string;
  actorUserId: number | null;
  ip: string;
}

/**
 * Inputs for the privileged account-unlock endpoint. Mirrors the legacy
 * POST /api/admin/users/:id/unlock contract: only privileged actors may
 * invoke; an audit log entry is written on success.
 */
export interface UnlockUserInput {
  targetUserId: number;
  actorUserId: number | null;
  ip: string;
}

export interface UnlockUserResult {
  message: string;
}
