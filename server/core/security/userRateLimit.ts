/**
 * FASE 14.6 — Per-user / per-company in-memory progressive rate limiter.
 * FASE 14.7.1 — Cooldown schedule extracted to shared rateSchedule.ts.
 *
 * Complements the existing IP-based `loginIpLimiter` (FASE 7).
 * That one protects unknown accounts; this one protects authenticated
 * identities by keying on the DB id rather than the network address,
 * making it resilient against IP rotation used by botnets.
 *
 * Progressive cooldown schedule (consecutive failures) — defined in
 * rateSchedule.ts and shared with AuthCoreService L2:
 *   1–2  fails  → no block (normal wrong-password tolerance)
 *   3    fails  → 5 s cooldown
 *   5    fails  → 30 s cooldown
 *   8    fails  → 2 min cooldown
 *   10+  fails  → 5 min cooldown
 *
 * A successful login resets the counter for that key.
 *
 * Risk score = consecutiveFails (0–100, capped). Callers use it to decide
 * whether to emit a BRUTE_FORCE_DETECTED security event.
 *
 * Memory: one Map entry per active key; entries are pruned on success or
 * when blockedUntil has passed at check time, so the Map stays small.
 */

import { RATE_LIMIT_SCHEDULE } from "../auth/rateSchedule";

interface UserRateEntry {
  consecutiveFails: number;
  blockedUntil: number; // epoch ms; 0 = not blocked
  cooldownMs: number;
}

const store = new Map<string, UserRateEntry>();

// Background pruner — removes stale entries whose block has expired and have
// zero consecutive failures (i.e. they will never block future requests).
// Runs every 15 min to keep memory bounded even under distributed bruteforce.
// Guard prevents duplicate intervals on tsx hot-reload.
if (!(globalThis as any).__userRateLimitPruneStarted) {
  (globalThis as any).__userRateLimitPruneStarted = true;
  const PRUNE_INTERVAL_MS = 15 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of store) {
      if (entry.blockedUntil <= now && entry.consecutiveFails === 0) {
        store.delete(key);
        pruned++;
      }
    }
    if (pruned > 0) {
      console.log("[USER_RATE_LIMIT_PRUNED]", { pruned, remaining: store.size, ts: new Date().toISOString() });
    }
  }, PRUNE_INTERVAL_MS).unref();
}

function computeCooldown(consecutiveFails: number): number {
  for (const tier of RATE_LIMIT_SCHEDULE) {
    if (consecutiveFails >= tier.minFails) return tier.cooldownMs;
  }
  return 0;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether the key is currently blocked.
 * Returns `{ allowed: true }` when the key may proceed,
 * `{ allowed: false, retryAfterMs }` when it must wait.
 */
export function checkUserRateLimit(
  key: string,
): { allowed: boolean; retryAfterMs?: number; riskScore: number } {
  const entry = store.get(key);
  if (!entry) return { allowed: true, riskScore: 0 };

  const now = Date.now();
  if (entry.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterMs: entry.blockedUntil - now,
      riskScore: Math.min(entry.consecutiveFails, 100),
    };
  }

  return {
    allowed: true,
    riskScore: Math.min(entry.consecutiveFails, 100),
  };
}

/**
 * Record a successful login — resets the failure counter for this key.
 */
export function recordUserLoginSuccess(key: string): void {
  store.delete(key);
}

/**
 * Record a failed login attempt.
 * Returns the new block state so the caller can log BRUTE_FORCE_DETECTED.
 */
export function recordUserLoginFailure(key: string): {
  blocked: boolean;
  cooldownMs: number;
  riskScore: number;
} {
  const now = Date.now();
  const entry = store.get(key) ?? { consecutiveFails: 0, blockedUntil: 0, cooldownMs: 0 };

  entry.consecutiveFails += 1;
  const cooldownMs = computeCooldown(entry.consecutiveFails);

  if (cooldownMs > 0) {
    entry.blockedUntil = now + cooldownMs;
    entry.cooldownMs = cooldownMs;
  }

  store.set(key, entry);

  return {
    blocked: cooldownMs > 0,
    cooldownMs,
    riskScore: Math.min(entry.consecutiveFails, 100),
  };
}

/**
 * Immediately block a key for a given duration (abuse detection override).
 * Used when external signals (e.g. WAF, SIEM) indicate an account is under attack.
 */
export function blockUserFor(key: string, durationMs: number): void {
  const entry = store.get(key) ?? { consecutiveFails: 0, blockedUntil: 0, cooldownMs: 0 };
  entry.blockedUntil = Date.now() + durationMs;
  entry.cooldownMs = durationMs;
  store.set(key, entry);
}

/**
 * Return a snapshot of all active entries — for admin observability only.
 */
export function getUserRateLimitSnapshot(): Array<{ key: string; consecutiveFails: number; blockedUntil: number }> {
  const now = Date.now();
  const result: Array<{ key: string; consecutiveFails: number; blockedUntil: number }> = [];
  for (const [key, entry] of store) {
    if (entry.consecutiveFails > 0 || entry.blockedUntil > now) {
      result.push({ key, consecutiveFails: entry.consecutiveFails, blockedUntil: entry.blockedUntil });
    }
  }
  return result;
}
