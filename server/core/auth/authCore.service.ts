/**
 * FASE 14.7 — AuthCoreService: single source of truth for auth decisions.
 * FASE 14.7.1 — Unified logging pipeline + shared rate schedule + logSessionInvalidation.
 *
 * Centralises:
 *  1. DB-backed rate limiting (persistent across server restarts).
 *  2. Session validation (tokenVersion + deviceId checks).
 *  3. Typed security-event constants (AUTH_EVENTS) replacing raw strings.
 *  4. Unified `logAuthEvent()` — single call that writes to BOTH the in-memory
 *     security event buffer AND the console/alertEngine for critical events.
 *     Callers no longer need to call logSecurity() separately.
 *  5. `logSessionInvalidation()` — decouples sessionGuard from storage.
 *
 * Architecture decisions:
 *  • Queries `auth_attempts` table directly via Drizzle — this is a core
 *    infrastructure service that sits below the storage facade.
 *  • Fail-closed on DB errors — a DB outage invalidates sessions.
 *  • The in-memory userRateLimit (FASE 14.6) is telemetry only and never blocks.
 *  • Device binding is mandatory: session.deviceId must exist and must match
 *    the request X-Device-Id header for authenticated requests.
 *  • Rate schedule is now imported from rateSchedule.ts — single source shared
 *    with the L1 in-memory limiter.
 */

import { and, eq, gte, lt, desc } from "drizzle-orm";
import { db } from "../../database/db";
import { authAttempts } from "../../../shared/schema";
import { storage } from "../../services/storage";
import { logSecurityEvent, logSecurity } from "../security/securityLogger";
import { emitEvent } from "../events/event.emitter";
import type { SessionPayload } from "../../modules/auth/auth.types";
import { RATE_LIMIT_SCHEDULE } from "./rateSchedule";

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

/**
 * Events that warrant console emission + alertEngine forwarding via logSecurity().
 * Non-critical events (e.g. LOGIN_SUCCESS) go only to the in-memory buffer.
 */
const CRITICAL_AUTH_EVENTS = new Set<AuthEventType>([
  AUTH_EVENTS.BRUTE_FORCE,
  AUTH_EVENTS.RATE_LIMITED,
  AUTH_EVENTS.SESSION_INVALIDATED,
  AUTH_EVENTS.DEVICE_MISMATCH,
  AUTH_EVENTS.TOKEN_VERSION_MISMATCH,
  AUTH_EVENTS.REVOKE_ALL_SESSIONS,
  AUTH_EVENTS.LOGIN_BLOCKED_LOCKED,
  AUTH_EVENTS.LOGIN_BLOCKED_INACTIVE,
  AUTH_EVENTS.LOGIN_BLOCKED_TEMP_PW,
]);

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
   * Uses RATE_LIMIT_SCHEDULE (shared with L1) to decide window size and block
   * duration. Fail-open: any DB error returns `{ allowed: true }` so a DB
   * outage can't deny access.
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
      const maxWindowMs = Math.max(...RATE_LIMIT_SCHEDULE.map(t => t.windowMs));
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
      for (const tier of RATE_LIMIT_SCHEDULE) {
        const windowStart = now - tier.windowMs;
        const failsInWindow = failTimestamps.filter(t => t >= windowStart).length;

        if (failsInWindow >= tier.minFails) {
          // Find most recent failure in this window
          const lastFail = Math.max(...failTimestamps.filter(t => t >= windowStart));
          const blockExpiry = lastFail + tier.cooldownMs;

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
      emitEvent({
        type: params.success ? "AUTH_LOGIN_SUCCESS" : "AUTH_LOGIN_FAILURE",
        entityType: params.userId ? "user" : params.companyId ? "company" : undefined,
        entityId: String(params.userId ?? params.companyId ?? ""),
        metadata: { ip: params.ip, endpoint: params.endpoint ?? "login", success: params.success },
      });
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
   *  • The session is unauthenticated — pass-through.
   *  • tokenVersion matches the DB record.
   *
   * Returns `{ valid: false, reason }` when:
   *  • The account no longer exists in the DB.
   *  • The session's tokenVersion is stale (revokeAllSessions was called).
   *  • Both sides advertise a deviceId and they differ.
   *
   * Fail-closed: any DB error returns `{ valid: false }` so access is denied
   * when session verification cannot be trusted.
   */
  async validateSession(
    session: Partial<SessionPayload>,
    requestDeviceId?: string,
  ): Promise<SessionValidation> {
    // Unauthenticated session → pass through
    if (!session.userId && !session.companyId) return { valid: true };
    if (session.tokenVersion === undefined) return { valid: false, reason: "TOKEN_VERSION_MISMATCH" };

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

      // Device binding: only enforce when BOTH sides advertise a deviceId.
      // If session.deviceId is undefined (login sent no fingerprint), skip check
      // so pre-binding sessions and master logins are never kicked by DEVICE_MISMATCH.
      if (session.deviceId && requestDeviceId && session.deviceId !== requestDeviceId) {
        return { valid: false, reason: "DEVICE_MISMATCH" };
      }

      return { valid: true };
    } catch (err: any) {
      logSecurity(`[SECURITY] AUTH_CORE_VALIDATE_SESSION_ERROR | error=${err?.message ?? "unknown"} | decision=REJECT`);
      return { valid: false, reason: "ACCOUNT_NOT_FOUND" };
    }
  }

  // ── Unified event logger ────────────────────────────────────────────────

  /**
   * FASE 14.7.1 — Unified logging pipeline. Single call that:
   *   1. Writes to the in-memory security event buffer (observability).
   *   2. For critical events: also emits to console + alertEngine via logSecurity().
   *
   * Callers (AuthService, sessionGuard) no longer call logSecurity() directly —
   * this method is the only emission point for auth security events.
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
    emitEvent({
      type:
        type === AUTH_EVENTS.LOGIN_SUCCESS
          ? "AUTH_LOGIN_SUCCESS"
          : type === AUTH_EVENTS.RATE_LIMITED
            ? "AUTH_RATE_LIMIT_HIT"
            : type === AUTH_EVENTS.SESSION_INVALIDATED
              ? "SESSION_INVALID"
              : "SECURITY_ANOMALY",
      entityType: payload.userId ? "user" : payload.companyId ? "company" : undefined,
      entityId: String(payload.userId ?? payload.companyId ?? ""),
      metadata: payload.metadata ?? payload,
    });
    // 1. In-memory circular buffer (always)
    logSecurityEvent({
      type,
      ip: payload.ip,
      userId: payload.userId ?? payload.companyId,
      path: payload.path,
      requestId: payload.requestId,
      metadata: payload.metadata,
    });

    // 2. Console + alertEngine (critical events only)
    if (CRITICAL_AUTH_EVENTS.has(type)) {
      const actor = payload.userId
        ? `userId=${payload.userId}`
        : payload.companyId
          ? `companyId=${payload.companyId}`
          : "unknown";
      logSecurity(
        `[SECURITY] ${type} | ${actor} | ip=${payload.ip ?? "?"} | path=${payload.path ?? "?"}`,
      );
    }
  }

  // ── Session invalidation audit ──────────────────────────────────────────

  /**
   * FASE 14.7.1 — Decouples sessionGuard from the storage facade.
   *
   * Replaces the three-call pattern previously in sessionGuard:
   *   logSecurity(...)            → now handled inside logAuthEvent()
   *   authCoreService.logAuthEvent(...) → this method
   *   storage.createLog(...)      → now handled here (best-effort)
   *
   * sessionGuard becomes a pure thin adapter: zero direct dependencies on
   * storage or securityLogger.
   */
  async logSessionInvalidation(params: {
    eventType: AuthEventType;
    userId?: number;
    companyId?: number;
    ip: string;
    path: string;
    requestId?: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    // Unified event (buffer + console/alertEngine for critical)
    this.logAuthEvent(params.eventType, {
      ip: params.ip,
      path: params.path,
      requestId: params.requestId,
      userId: params.userId,
      companyId: params.companyId,
      metadata: { reason: params.reason, ...params.metadata },
    });

    // Persistent DB audit trail — best-effort, never throws
    storage.createLog({
      action: "SESSION_INVALIDATED",
      description: `Sessão encerrada por segurança: ${params.reason}. Usuário forçado a re-autenticar.`,
      userId: params.userId,
      companyId: params.companyId,
      ip: params.ip,
      level: "WARN",
    }).catch(() => {});
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
