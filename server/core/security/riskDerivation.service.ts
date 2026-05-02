/**
 * FASE 14.9 — Risk Derivation Layer (Safe Mode).
 *
 * 100% READ-ONLY intelligence service. Derives risk scores from existing
 * data (auth_attempts PostgreSQL table) without touching any auth decision
 * path, session logic, rate limiter, or logging pipeline.
 *
 * Architecture decisions:
 *  • Zero side effects — no writes, no locks, no cache mutation.
 *  • Fail-open — any DB error returns an empty result set; callers must not
 *    treat an empty result as "safe" for blocking decisions.
 *  • Risk scores are advisory only — they must NEVER be used to block login
 *    or any user action. The principle is: "Risk Layer is read, never decision."
 *  • Single DB query per call — fetches the last 7d of attempts and computes
 *    all metrics in JS to minimise round-trips and index pressure.
 *
 * Risk score formula (max 100):
 *   +40 pts max — failed logins (linear, +4 per failure, capped at 10 failures)
 *   +20 pts max — IP diversity (distinct IPs targeting the account, +5 per extra IP)
 *   +25 pts     — brute force signal (any IP targeting this account AND ≥1 other)
 *   +15 pts max — target spread (distinct IPs targeting the account, +3 each)
 */

import { and, gte, eq } from "drizzle-orm";
import { db } from "../../database/db";
import { authAttempts } from "../../../shared/schema";
import { logSecurity } from "./securityLogger";

export interface RiskBreakdown {
  failedLogins: number;
  successLogins: number;
  ipDiversity: number;
  targetSpread: number;
  bruteForceSignal: boolean;
}

export interface AccountRiskResult {
  companyId: number;
  riskScore: number;
  breakdown: RiskBreakdown;
}

// ── Score formula ────────────────────────────────────────────────────────────

function deriveScore(bd: RiskBreakdown): number {
  let score = 0;
  score += Math.min(bd.failedLogins * 4, 40);       // +40 max — failed logins
  score += Math.min((bd.ipDiversity - 1) * 5, 20);  // +20 max — IP diversity
  if (bd.bruteForceSignal) score += 25;              // +25     — brute force
  score += Math.min(bd.targetSpread * 3, 15);        // +15 max — target spread
  return Math.min(Math.max(score, 0), 100);
}

// ── Core computation ─────────────────────────────────────────────────────────

/**
 * Compute risk for all companies that appear in auth_attempts over the last 7d.
 * Returns results sorted by riskScore descending (highest risk first).
 */
export async function computeAllCompanyRisks(): Promise<AccountRiskResult[]> {
  try {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60_000);

    const rows = await db
      .select({
        companyId: authAttempts.companyId,
        ip:        authAttempts.ip,
        success:   authAttempts.success,
      })
      .from(authAttempts)
      .where(
        and(
          gte(authAttempts.createdAt, since7d),
          // Only rows with a companyId (exclude admin-only login attempts)
        ),
      )
      .limit(10_000);

    // Filter to company rows only
    const companyRows = rows.filter(r => r.companyId !== null);

    if (companyRows.length === 0) return [];

    // Build a global "brute force IPs" set: IPs that targeted 2+ distinct accounts
    // (across all companies and users)
    const allRows = rows; // includes userId rows if any
    const ipTargetMap = new Map<string, Set<string>>();
    for (const r of allRows) {
      const targets = ipTargetMap.get(r.ip) ?? new Set<string>();
      if (r.companyId) targets.add(`company:${r.companyId}`);
      ipTargetMap.set(r.ip, targets);
    }
    const bruteForcIPs = new Set<string>(
      [...ipTargetMap.entries()]
        .filter(([, targets]) => targets.size >= 2)
        .map(([ip]) => ip),
    );

    // Group by companyId
    const byCompany = new Map<number, { failures: number; successes: number; ips: Set<string> }>();
    for (const r of companyRows) {
      const cid = r.companyId as number;
      const entry = byCompany.get(cid) ?? { failures: 0, successes: 0, ips: new Set<string>() };
      if (r.success) entry.successes++;
      else           entry.failures++;
      entry.ips.add(r.ip);
      byCompany.set(cid, entry);
    }

    const results: AccountRiskResult[] = [];
    for (const [companyId, data] of byCompany) {
      const bruteForceSignal = [...data.ips].some(ip => bruteForcIPs.has(ip));
      const breakdown: RiskBreakdown = {
        failedLogins:   data.failures,
        successLogins:  data.successes,
        ipDiversity:    data.ips.size,
        targetSpread:   data.ips.size,  // distinct IPs that targeted this account
        bruteForceSignal,
      };
      results.push({ companyId, riskScore: deriveScore(breakdown), breakdown });
    }

    return results.sort((a, b) => b.riskScore - a.riskScore);
  } catch (err: any) {
    logSecurity(`[SECURITY] RISK_DERIVATION_ERROR | error=${err?.message ?? "unknown"}`);
    return [];
  }
}

/**
 * Compute risk for a single account (company or admin user).
 * Used for point lookups — e.g. displaying risk on a company detail page.
 */
export async function computeAccountRisk(
  companyId?: number,
  userId?: number,
): Promise<AccountRiskResult | null> {
  if (!companyId && !userId) return null;

  try {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60_000);

    const conditions = [gte(authAttempts.createdAt, since7d)];
    if (companyId) conditions.push(eq(authAttempts.companyId, companyId));
    else if (userId) conditions.push(eq(authAttempts.userId, userId));

    const rows = await db
      .select({ ip: authAttempts.ip, success: authAttempts.success })
      .from(authAttempts)
      .where(and(...conditions))
      .limit(1_000);

    if (rows.length === 0) return null;

    // Check which of this account's IPs are brute-force IPs (targeting other accounts too)
    const accountIPs = new Set(rows.map(r => r.ip));
    const bruteForceIPs = new Set<string>();
    for (const ip of accountIPs) {
      const allForIP = await db
        .select({ companyId: authAttempts.companyId, userId: authAttempts.userId })
        .from(authAttempts)
        .where(and(gte(authAttempts.createdAt, since7d), eq(authAttempts.ip, ip)))
        .limit(50);
      const targets = new Set(allForIP.map(r => r.companyId ? `company:${r.companyId}` : `user:${r.userId}`));
      if (targets.size >= 2) bruteForceIPs.add(ip);
    }

    const failures = rows.filter(r => !r.success).length;
    const successes = rows.filter(r => r.success).length;

    const breakdown: RiskBreakdown = {
      failedLogins:    failures,
      successLogins:   successes,
      ipDiversity:     accountIPs.size,
      targetSpread:    accountIPs.size,
      bruteForceSignal: bruteForceIPs.size > 0,
    };

    return {
      companyId: companyId ?? 0,
      riskScore: deriveScore(breakdown),
      breakdown,
    };
  } catch (err: any) {
    logSecurity(`[SECURITY] RISK_DERIVATION_ACCOUNT_ERROR | error=${err?.message ?? "unknown"}`);
    return null;
  }
}
