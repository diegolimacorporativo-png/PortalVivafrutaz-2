/**
 * Auth module — public type contracts.
 *
 * Architecture decision: same convention as the finance and users modules —
 * re-export the shared (Drizzle) types we need and add module-specific DTOs.
 * Consumers import only from this barrel, never from `@shared/schema`
 * directly, so the module's surface area stays explicit.
 */
export type { User, InsertUser, Company } from "@shared/schema";

import type { User, Company } from "@shared/schema";

/** Two flavours of caller — internal staff vs. B2B client portal. */
export type LoginType = "admin" | "company";

export interface LoginInput {
  email: string;
  password: string;
  type: LoginType;
}

/**
 * Discriminated outcome returned by the service to the controller.
 *
 * Architecture decision: the service stays HTTP-free, but auth has many
 * legitimate failure modes (wrong password, locked account, maintenance,
 * inactive account, etc.) each with its own status code AND its own
 * Portuguese message that the existing frontend depends on byte-for-byte.
 * A discriminated result keeps the legacy contract intact without leaking
 * Express into the service.
 */
export type LoginOutcome =
  | { kind: "admin-success"; user: User }
  | { kind: "company-success"; company: Company }
  /** FASE 14.5 — company authenticated but must change temporary password before proceeding */
  | { kind: "password-change-required"; companyId: number; email: string }
  | { kind: "failure"; status: number; message: string };

/** Outcome for the `/me` endpoint — same reasoning as above. */
export type MeOutcome =
  | { kind: "admin"; user: User }
  | { kind: "company"; company: Company }
  | { kind: "unauthenticated" };

/**
 * Shape of `req.session` that this module reads/writes. Only the fields the
 * auth module owns are listed here; other modules may add their own.
 */
export interface SessionPayload {
  userId?: number;
  companyId?: number;
  userType?: LoginType;
  /**
   * Cached role for the logged-in admin user. Stored at login so
   * requireRole() can authorize without an extra DB round-trip per request.
   * Absent for company-portal sessions (companies don't have a role).
   */
  userRole?: string;
  /**
   * FASE 14.6 — Snapshot of the account's tokenVersion at login time.
   * sessionVersionGuard compares this against the DB on every request;
   * a mismatch means the account's sessions were revoked (revokeAllSessions).
   */
  tokenVersion?: number;
  /**
   * FASE 14.6 — Optional device fingerprint supplied by the client at login.
   * Stored for per-device session isolation and audit trails.
   */
  deviceId?: string;
}

export interface ForgotPasswordOutcome {
  found: boolean;
  message: string;
  requestId?: number;
}
