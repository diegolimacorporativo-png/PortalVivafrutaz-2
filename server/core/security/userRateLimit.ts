/**
 * FASE 14.6 — Per-user / per-company in-memory progressive rate limiter.
 *
 * Complements the existing IP-based `loginIpLimiter` (FASE 7).
 * That one protects unknown accounts; this one protects authenticated
 * identities by keying on the DB id rather than the network address,
 * making it resilient against IP rotation used by botnets.
 *
 * Progressive cooldown schedule (consecutive failures):
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

interface UserRateEntry {
  consecutiveFails: number;
  blockedUntil: number; // epoch ms; 0 = not blocked
  cooldownMs: number;
}

const store = new Map<string, UserRateEntry>();

// Cooldown thresholds: [minFails, cooldownMs]
const THRESHOLDS: Array<[number, number]> = [
  [10,  5 * 60_000],
  [8,   2 * 60_000],
  [5,   30_000],
  [3,   5_000],
];

function computeCooldown(consecutiveFails: number): number {
  for (const [min, ms] of THRESHOLDS) {
    if (consecutiveFails >= min) return ms;
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

  // Block expired — prune if no consecutive fails remain
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
