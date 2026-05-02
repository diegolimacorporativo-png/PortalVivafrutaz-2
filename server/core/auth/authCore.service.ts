/**
 * FASE 14.7 — AuthCoreService: single source of truth for auth decisions.
 *
 * Centralises:
 *  1. DB-backed rate limiting (persistent across server restarts, replaces
 *     in-memory userRateLimit as the authoritative source).
 *  2. Session validation (tokenVersion + deviceId checks).
 *  3. Typed security-event constants (AUTH_EVENTS) replacing raw strings.
 *  4. Unified `logAuthEvent()` wrapping securityLogger.
 *
 * Architecture decisions:
 *  • Queries `auth_attempts` table directly via Drizzle — this is a core
 *    infrastructure service that sits below the storage facade.
 *  • Fail-open on DB errors — a DB outage must NOT lock legitimate users out.
 *    Failures are logged to console but never thrown to callers.
 *  • The in-memory userRateLimit (FASE 14.6) is demoted to L1 fast-path cache:
 *    it blocks obviously-hot keys without a DB round-trip; this service is L2.
 *  • Device binding is enforced as "warn then block": if both sides advertise a
 *    deviceId and they differ, the request is rejected. Clients that never send
 *    X-Device-Id (most existing frontend code) are NOT affected.
 */

import { and, eq, gte, lt, desc } from "drizzle-orm";
import { db } from "../../database/db";
import { authAttempts } from "../../../shared/schema";
import { storage } from "../../services/storage";
import { logSecurityEvent, logSecurity } from "../security/securityLogger";
import type { SessionPayload } from "../../modules/auth/auth.types";

// ── Typed security-event constants ───────────────────────────────────────────

export const AUTH_EVENTS = {
  LOGIN_SUCCESS:            "AUTH_LOGIN_SUCCESS",
  LOGIN_FAILED:             "AUTH_LOGIN_FAILED",
  LOGIN_BLOCKED_LOCKED:     "AUTH_LOGIN_BLOCKED_LOCKED",
  LOGIN_BLOCKED_INACTIVE:   "AUTH_LOGIN_BLOCKED_INACTIVE",
  LOGIN_BLOCKED_TEMP_PW:    "AUTH_LOGIN_BLOCKED_TEMP_PW",
  BRUTE_FORCE:              "AUTH_BRUTE_FORCE",
  RATE_LIMITED:             "AUTH_RATE_LIMITED",
  SESSION_INVALIDATED:      "AUTH_SESSION_INVALIDATED",
  DEVICE_MISMATCH:          "AUTH_DEVICE_MISMATCH",
  TOKEN_VERSION_MISMATCH:   "AUTH_TOKEN_VERSION_MISMATCH",
  REVOKE_ALL_SESSIONS:      "AUTH_REVOKE_ALL_SESSIONS",
  ACCOUNT_NOT_FOUND:        "AUTH_ACCOUNT_NOT_FOUND",
} as const;

export type AuthEventType = typeof AUTH_EVENTS[keyof typeof AUTH_EVENTS];

// ── Progressive cooldown schedule (shared with in-memory L1) ─────────────────

interface CooldownThreshold {
  minFails: number;
  windowMs: number;   // how far back to look
  cooldownMs: number; // how long to block after threshold is reached
}

const COOLDOWN_SCHEDULE: CooldownThreshold[] = [
  { minFails: 10, windowMs: 10 * 60_000, cooldownMs: 5 * 60_000 },
  { minFails:  8, windowMs:  5 * 60_000, cooldownMs: 2 * 60_000 },
  { minFails:  5, windowMs:  5 * 60_000, cooldownMs: 30_000 },
  { minFails:  3, windowMs:  1 * 60_000, cooldownMs: 5_000 },
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RateCheckResult {
  allowed: boolean;
  recentFailures: number;
  retryAfterMs?: number;
  riskScore: number;  // 0-100; >5 = suspicious; >10 = brute force
}

export interface SessionValidation {
  valid: boolean;
  reason?: "TOKEN_VERSION_MISMATCH" | "DEVICE_MISMATCH" | "ACCOUNT_NOT_FOUND";
}

// ── Service ───────────────────────────────────────────────────────────────────

class AuthCoreService {

  // ── DB-based rate limit ─────────────────────────────────────────────────

  /**
   * Query auth_attempts to determine whether this account/IP is rate-limited.
   * Uses the COOLDOWN_SCHEDULE to decide window size and block duration.
   * Fail-open: any DB error returns `{ allowed: true }` so a DB outage can't
   * deny access.
   */
  async checkDbRateLimit(params: {
    companyId?: number;
    userId?: number;
    ip: string;
    endpoint?: string;
  }): Promise<RateCheckResult> {
    try {
      const { companyId, userId } = params;
      if (!companyId && !userId) return { allowed: true, recentFailures: 0, riskScore: 0 };

      // Determine worst-case window (largest) so we query once
      const maxWindowMs = Math.max(...COOLDOWN_SCHEDULE.map(t => t.windowMs));
      const since = new Date(Date.now() - maxWindowMs);

      const conditions = [
        eq(authAttempts.success, false),
        gte(authAttempts.createdAt, since),
      ];
      if (companyId) conditions.push(eq(authAttempts.companyId, companyId));
      else if (userId) conditions.push(eq(authAttempts.userId, userId));

      // Fetch recent failures (newest first, limited for performance)
      const rows = await db
        .select({ createdAt: authAttempts.createdAt })
        .from(authAttempts)
        .where(and(...conditions))
        .orderBy(desc(authAttempts.createdAt))
        .limit(50);

      const now = Date.now();
      const failTimestamps = rows.map(r => r.createdAt.getTime());

      // Walk thresholds from most to least severe
      for (const threshold of COOLDOWN_SCHEDULE) {
        const windowStart = now - threshold.windowMs;
        const failsInWindow = failTimestamps.filter(t => t >= windowStart).length;

        if (failsInWindow >= threshold.minFails) {
          // Find most recent failure in this window
          const lastFail = Math.max(...failTimestamps.filter(t => t >= windowStart));
          const blockExpiry = lastFail + threshold.cooldownMs;

          if (blockExpiry > now) {
            return {
              allowed: false,
              recentFailures: failsInWindow,
              retryAfterMs: blockExpiry - now,
              riskScore: Math.min(failsInWindow * 10, 100),
            };
          }
        }
      }

      // Count failures in last minute for risk score (not blocked but suspicious)
      const lastMinute = now - 60_000;
      const recentFails = failTimestamps.filter(t => t >= lastMinute).length;

      return {
        allowed: true,
        recentFailures: recentFails,
        riskScore: Math.min(recentFails * 10, 100),
      };
    } catch (err: any) {
      // Fail-open: DB error must NOT lock users out
      logSecurity(`[SECURITY] AUTH_CORE_RATE_LIMIT_ERROR | error=${err?.message ?? "unknown"}`);
      return { allowed: true, recentFailures: 0, riskScore: 0 };
    }
  }

  /**
   * Persist one login attempt to auth_attempts.
   * Fire-and-forget: failures are logged but never thrown.
   */
  async recordAttempt(params: {
    companyId?: number;
    userId?: number;
    ip: string;
    endpoint?: string;
    success: boolean;
  }): Promise<void> {
    try {
      await db.insert(authAttempts).values({
        companyId: params.companyId ?? null,
        userId: params.userId ?? null,
        ip: params.ip,
        endpoint: params.endpoint ?? "login",
        success: params.success,
      });
    } catch (err: any) {
      logSecurity(`[SECURITY] AUTH_CORE_RECORD_ATTEMPT_ERROR | error=${err?.message ?? "unknown"}`);
    }
  }

  // ── Session validation ──────────────────────────────────────────────────

  /**
   * Validate a session's tokenVersion (and optionally deviceId) against the DB.
   *
   * Called by sessionGuard on every authenticated API request. Returns
   * `{ valid: true }` when:
   *  • The session carries no tokenVersion (pre-FASE-14.6 session) — pass-through.
   *  • The session is unauthenticated — pass-through.
   *  • tokenVersion matches the DB record.
   *
   * Returns `{ valid: false, reason }` when:
   *  • The account no longer exists in the DB.
   *  • The session's tokenVersion is stale (revokeAllSessions was called).
   *  • Both sides advertise a deviceId and they differ.
   *
   * Fail-open: any DB error returns `{ valid: true }` to prevent DB outages
   * from locking everyone out.
   */
  async validateSession(
    session: Partial<SessionPayload>,
    requestDeviceId?: string,
  ): Promise<SessionValidation> {
    // Unauthenticated or pre-FASE-14.6 session → pass through
    if (!session.userId && !session.companyId) return { valid: true };
    if (session.tokenVersion === undefined) return { valid: true };

    try {
      if (session.userId) {
        const user = await storage.getUser(session.userId);
        if (!user) return { valid: false, reason: "ACCOUNT_NOT_FOUND" };

        const dbVersion = (user as any).tokenVersion ?? 0;
        if (session.tokenVersion !== dbVersion) {
          return { valid: false, reason: "TOKEN_VERSION_MISMATCH" };
        }
      } else if (session.companyId) {
        const company = await storage.getCompany(session.companyId);
        if (!company) return { valid: false, reason: "ACCOUNT_NOT_FOUND" };

        const dbVersion = (company as any).tokenVersion ?? 0;
        if (session.tokenVersion !== dbVersion) {
          return { valid: false, reason: "TOKEN_VERSION_MISMATCH" };
        }
      }

      // Device binding: only enforce if BOTH sides declare a deviceId
      if (requestDeviceId && session.deviceId && requestDeviceId !== session.deviceId) {
        return { valid: false, reason: "DEVICE_MISMATCH" };
      }

      return { valid: true };
    } catch (err: any) {
      // Fail-open: DB error must NOT kick active sessions
      logSecurity(`[SECURITY] AUTH_CORE_VALIDATE_SESSION_ERROR | error=${err?.message ?? "unknown"}`);
      return { valid: true };
    }
  }

  // ── Unified event logger ────────────────────────────────────────────────

  /**
   * Log a typed auth security event to the in-memory securityLogger.
   * Wraps `logSecurityEvent` with typed constants so callers don't use raw strings.
   */
  logAuthEvent(
    type: AuthEventType,
    payload: {
      ip?: string;
      userId?: number;
      companyId?: number;
      path?: string;
      requestId?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): void {
    logSecurityEvent({
      type,
      ip: payload.ip,
      userId: payload.userId ?? payload.companyId,
      path: payload.path,
      requestId: payload.requestId,
      metadata: payload.metadata,
    });
  }

  // ── Pruning ─────────────────────────────────────────────────────────────

  /**
   * Delete auth_attempts older than `olderThanDays` days.
   * Call from a maintenance cron to keep the table bounded.
   * Returns the number of rows deleted, or -1 on error.
   */
  async pruneOldAttempts(olderThanDays = 30): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
      const deleted = await db
        .delete(authAttempts)
        .where(lt(authAttempts.createdAt, cutoff));
      return (deleted as any).rowCount ?? 0;
    } catch (err: any) {
      logSecurity(`[SECURITY] AUTH_CORE_PRUNE_ERROR | error=${err?.message ?? "unknown"}`);
      return -1;
    }
  }
}

export const authCoreService = new AuthCoreService();
