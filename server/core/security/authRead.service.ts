/**
 * FASE 14.10 — Auth Read Layer Abstraction.
 *
 * SINGLE SOURCE OF TRUTH for all security-related reads from auth_attempts.
 *
 * Architecture:
 *   Auth Engine (AuthCore)
 *         ↓
 *   auth_attempts (DB)
 *         ↓
 *   AuthReadService  ← YOU ARE HERE (the only door in/out)
 *         ↓
 *   ├── RiskDerivationService
 *   ├── Security Overview API
 *   └── Security Risk API
 *         ↓
 *   Frontend dashboards
 *
 * RULES:
 *  • ZERO direct queries to auth_attempts outside this file.
 *  • ZERO side effects — all functions are 100% read-only.
 *  • ZERO writes, locks, or mutations.
 *  • All aggregations that depend only on a row set are exposed as pure
 *    functions that accept already-fetched rows, so callers can batch a
 *    single query and reuse the same slice for multiple stats.
 *
 * USAGE PATTERN (recommended — fetch once, compute many):
 *
 *   const rows = await getAuthAttempts({ from: since7d });
 *   const stats = computeAuthStats(rows);
 *   const attackers = computeTopAttackers(rows.filter(r => !r.success));
 */

import { and, gte, lte, eq, desc } from "drizzle-orm";
import { db } from "../../database/db";
import { authAttempts } from "../../../shared/schema";

// ── Shared types ─────────────────────────────────────────────────────────────

export interface AuthReadFilters {
  companyId?: number;
  userId?: number;
  ip?: string;
  success?: boolean;
  from?: Date;
  to?: Date;
  /** Hard cap — defaults to 5 000 rows per call. */
  limit?: number;
}

export interface NormalizedAttempt {
  companyId: number | null;
  userId:    number | null;
  ip:        string;
  endpoint:  string | null;
  success:   boolean;
  createdAt: Date;
}

export interface AuthWindow {
  from: Date;
  to?:  Date;
}

export interface AuthStats {
  totalAttempts:   number;
  successCount:    number;
  failureCount:    number;
  uniqueIPs:       number;
  uniqueAccounts:  number;
  /** 0–100 integer */
  failureRate:     number;
}

export interface AttackerInfo {
  ip:                  string;
  failures:            number;
  targetsCount:        number;
  accountsTargeted:    string[];
  /** Simple composite read-only score (0–100) — advisory only */
  aggressivenessScore: number;
}

export interface CompanySecurityProfile {
  companyId: number;
  window7d: {
    failures:  number;
    successes: number;
    uniqueIPs: number;
    firstSeen: Date | null;
    lastSeen:  Date | null;
  };
  window24h: {
    failures:  number;
    successes: number;
    uniqueIPs: number;
  };
  /** IPs observed against this company that also targeted other accounts */
  bruteForceIPs: string[];
  riskIndicators: {
    hasRecentFailures:   boolean;
    hasHighIPDiversity:  boolean;
    hasBruteForceSignal: boolean;
    hasHighFailureRate:  boolean;
  };
}

// ── Primitive: fetch rows ─────────────────────────────────────────────────────

/**
 * Fetch normalized auth_attempts rows matching the given filters.
 * This is the ONLY function that issues a SELECT against auth_attempts.
 * All other functions in this module call this one.
 */
export async function getAuthAttempts(
  filters: AuthReadFilters = {},
): Promise<NormalizedAttempt[]> {
  const conditions = [];

  if (filters.from)                   conditions.push(gte(authAttempts.createdAt, filters.from));
  if (filters.to)                     conditions.push(lte(authAttempts.createdAt, filters.to));
  if (filters.companyId !== undefined) conditions.push(eq(authAttempts.companyId, filters.companyId));
  if (filters.userId    !== undefined) conditions.push(eq(authAttempts.userId,    filters.userId));
  if (filters.ip        !== undefined) conditions.push(eq(authAttempts.ip,        filters.ip));
  if (filters.success   !== undefined) conditions.push(eq(authAttempts.success,   filters.success));

  const base = db
    .select({
      companyId: authAttempts.companyId,
      userId:    authAttempts.userId,
      ip:        authAttempts.ip,
      endpoint:  authAttempts.endpoint,
      success:   authAttempts.success,
      createdAt: authAttempts.createdAt,
    })
    .from(authAttempts)
    .orderBy(desc(authAttempts.createdAt))
    .limit(filters.limit ?? 5_000);

  return conditions.length > 0 ? base.where(and(...conditions)) : base;
}

// ── Pure aggregations (operate on already-fetched rows) ───────────────────────

/**
 * Compute summary statistics from a pre-fetched row set.
 * Call this on the same slice you already have — no extra DB round-trip.
 */
export function computeAuthStats(rows: NormalizedAttempt[]): AuthStats {
  const successCount = rows.filter(r =>  r.success).length;
  const failureCount = rows.filter(r => !r.success).length;

  const uniqueIPs = new Set(rows.map(r => r.ip)).size;

  const accounts = new Set(
    rows
      .map(r => r.companyId ? `company:${r.companyId}` : r.userId ? `user:${r.userId}` : null)
      .filter((x): x is string => x !== null),
  );

  return {
    totalAttempts:  rows.length,
    successCount,
    failureCount,
    uniqueIPs,
    uniqueAccounts: accounts.size,
    failureRate: rows.length === 0 ? 0 : Math.round((failureCount / rows.length) * 100),
  };
}

/**
 * Compute top attackers from a failure-only row slice.
 * Pass `rows.filter(r => !r.success)` as input.
 *
 * aggressivenessScore formula (0–100, advisory/read-only):
 *   min(failures × 2 + targetsCount × 5, 100)
 */
export function computeTopAttackers(failureRows: NormalizedAttempt[]): AttackerInfo[] {
  const ipMap = new Map<string, { failures: number; targets: Set<string> }>();

  for (const r of failureRows) {
    const entry = ipMap.get(r.ip) ?? { failures: 0, targets: new Set<string>() };
    entry.failures++;
    if (r.companyId) entry.targets.add(`company:${r.companyId}`);
    if (r.userId)    entry.targets.add(`user:${r.userId}`);
    ipMap.set(r.ip, entry);
  }

  return Array.from(ipMap.entries())
    .map(([ip, d]) => ({
      ip,
      failures:            d.failures,
      targetsCount:        d.targets.size,
      accountsTargeted:    [...d.targets],
      aggressivenessScore: Math.min(d.failures * 2 + d.targets.size * 5, 100),
    }))
    .sort((a, b) => b.failures - a.failures);
}

// ── Composed async helpers (for external callers that need one call) ──────────

/**
 * Fetch and aggregate in one go — thin wrapper for callers
 * that don't need the raw rows.
 */
export async function getAuthStats(window: AuthWindow): Promise<AuthStats> {
  const rows = await getAuthAttempts({ from: window.from, to: window.to });
  return computeAuthStats(rows);
}

/**
 * Fetch failures and return top attacker list.
 */
export async function getTopAttackers(window: AuthWindow): Promise<AttackerInfo[]> {
  const rows = await getAuthAttempts({ from: window.from, to: window.to, success: false });
  return computeTopAttackers(rows);
}

/**
 * Build a full company security profile from a single DB fetch (7d window),
 * then derive the 24h sub-window and brute-force signals in JS.
 *
 * Brute force detection uses a second pass over the 7d failure set to check
 * which IPs appear against multiple distinct accounts — avoids N+1 queries
 * by grouping all company-window failures by IP once.
 */
export async function getCompanySecurityProfile(
  companyId: number,
): Promise<CompanySecurityProfile> {
  const since7d  = new Date(Date.now() - 7  * 24 * 60 * 60_000);
  const since24h = new Date(Date.now() -      24 * 60 * 60_000);

  // Single DB fetch covers both 7d and 24h windows
  const rows7d = await getAuthAttempts({ companyId, from: since7d });
  const rows24h = rows7d.filter(r => r.createdAt.getTime() >= since24h.getTime());

  const failures7d  = rows7d.filter(r => !r.success).length;
  const successes7d = rows7d.filter(r =>  r.success).length;
  const ips7d       = new Set(rows7d.map(r => r.ip));

  const failures24h  = rows24h.filter(r => !r.success).length;
  const successes24h = rows24h.filter(r =>  r.success).length;
  const ips24h       = new Set(rows24h.map(r => r.ip));

  const dates7d = rows7d.map(r => r.createdAt.getTime());

  // Brute force: identify IPs that appear in the failures of OTHER accounts too.
  // We do a second query only for failure rows — still a single additional query.
  const failureRows7d = rows7d.filter(r => !r.success);
  const companyIPs = new Set(failureRows7d.map(r => r.ip));
  const bruteForceIPs: string[] = [];

  if (companyIPs.size > 0) {
    // Fetch all failures in the 7d window across all accounts, filtered by
    // the IPs we already know attacked this company
    const allFailures7d = await getAuthAttempts({ from: since7d, success: false });
    const ipTargetMap = new Map<string, Set<string>>();
    for (const r of allFailures7d) {
      if (!companyIPs.has(r.ip)) continue;
      const targets = ipTargetMap.get(r.ip) ?? new Set<string>();
      if (r.companyId) targets.add(`company:${r.companyId}`);
      if (r.userId)    targets.add(`user:${r.userId}`);
      ipTargetMap.set(r.ip, targets);
    }
    for (const [ip, targets] of ipTargetMap) {
      if (targets.size >= 2) bruteForceIPs.push(ip);
    }
  }

  return {
    companyId,
    window7d: {
      failures:  failures7d,
      successes: successes7d,
      uniqueIPs: ips7d.size,
      firstSeen: dates7d.length ? new Date(Math.min(...dates7d)) : null,
      lastSeen:  dates7d.length ? new Date(Math.max(...dates7d)) : null,
    },
    window24h: {
      failures:  failures24h,
      successes: successes24h,
      uniqueIPs: ips24h.size,
    },
    bruteForceIPs,
    riskIndicators: {
      hasRecentFailures:   failures24h > 0,
      hasHighIPDiversity:  ips7d.size >= 3,
      hasBruteForceSignal: bruteForceIPs.length > 0,
      hasHighFailureRate:  rows7d.length > 0 && failures7d / rows7d.length > 0.5,
    },
  };
}
