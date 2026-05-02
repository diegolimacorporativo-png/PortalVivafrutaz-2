/**
 * FASE 14.7.1 — Shared progressive rate limit schedule.
 *
 * Single source of truth for cooldown thresholds used by both:
 *   L1 — in-memory userRateLimit (fast-path, keyed by consecutive failures)
 *   L2 — DB-backed AuthCoreService (persistent, keyed by failures in windowMs)
 *
 * windowMs: how far back L2 looks in auth_attempts per tier.
 *           L1 ignores this field — it counts consecutive fails, not windowed ones.
 * cooldownMs: block duration once minFails is reached (both L1 + L2).
 * minFails: minimum failure count to trigger this tier.
 *
 * Ordered most-severe → least-severe; evaluation stops at first match.
 */

export interface RateLimitTier {
  minFails: number;
  windowMs: number;
  cooldownMs: number;
}

export const RATE_LIMIT_SCHEDULE: readonly RateLimitTier[] = [
  { minFails: 10, windowMs: 10 * 60_000, cooldownMs: 5 * 60_000 },
  { minFails:  8, windowMs:  5 * 60_000, cooldownMs: 2 * 60_000 },
  { minFails:  5, windowMs:  5 * 60_000, cooldownMs:    30_000  },
  { minFails:  3, windowMs:  1 * 60_000, cooldownMs:     5_000  },
];
