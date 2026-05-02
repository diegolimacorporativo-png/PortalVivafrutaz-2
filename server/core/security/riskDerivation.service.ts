/**
 * FASE 14.9 — Risk Derivation Layer (Safe Mode).
 * FASE 14.10 — Refactored to use AuthReadService as the single read path.
 *
 * 100% READ-ONLY intelligence service. Derives risk scores from existing
 * data without touching any auth decision path, session logic, rate limiter,
 * or logging pipeline.
 *
 * Data flow:
 *   auth_attempts (DB) → AuthReadService → RiskDerivationService → callers
 *
 * Risk score formula (max 100):
 *   +40 pts max — failed logins  (+4 per failure, capped at 10)
 *   +20 pts max — IP diversity   (+5 per extra IP beyond the first)
 *   +25 pts     — brute force signal (any IP targeting this account + ≥1 other)
 *   +15 pts max — target spread  (+3 per distinct attacker IP, capped at 5)
 *
 * PRINCIPLE: "Risk Layer is read, never decision."
 */

import {
  getAuthAttempts,
  computeTopAttackers,
  type NormalizedAttempt,
} from "./authRead.service";

export interface RiskBreakdown {
  failedLogins:     number;
  successLogins:    number;
  ipDiversity:      number;
  targetSpread:     number;
  bruteForceSignal: boolean;
}

export interface AccountRiskResult {
  companyId: number;
  riskScore:  number;
  breakdown:  RiskBreakdown;
}

// ── Score formula ─────────────────────────────────────────────────────────────

function deriveScore(bd: RiskBreakdown): number {
  let score = 0;
  score += Math.min(bd.failedLogins  * 4, 40);       // +40 max
  score += Math.min((bd.ipDiversity - 1) * 5, 20);   // +20 max
  if (bd.bruteForceSignal) score += 25;               // +25
  score += Math.min(bd.targetSpread * 3, 15);         // +15 max
  return Math.min(Math.max(score, 0), 100);
}

// ── Brute force IP set ────────────────────────────────────────────────────────

/**
 * Given the full 7d failure row set, return the set of IPs that targeted
 * 2+ distinct accounts (company or user). This is computed once over the
 * batch and shared across all per-company risk derivations.
 */
function buildBruteForceIPSet(failureRows: NormalizedAttempt[]): Set<string> {
  const attackers = computeTopAttackers(failureRows);
  return new Set(attackers.filter(a => a.targetsCount >= 2).map(a => a.ip));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute risk for all companies appearing in auth_attempts over the last 7d.
 *
 * Uses a SINGLE DB fetch via AuthReadService, then derives all per-company
 * metrics in JS — zero additional round-trips.
 *
 * Returns results sorted by riskScore descending (highest risk first).
 */
export async function computeAllCompanyRisks(): Promise<AccountRiskResult[]> {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60_000);

  // Single query — AuthReadService is the only door in/out of auth_attempts
  const allRows = await getAuthAttempts({ from: since7d, limit: 10_000 });

  // Only company-scoped rows contribute to company risk profiles
  const companyRows = allRows.filter(r => r.companyId !== null);
  if (companyRows.length === 0) return [];

  // Build brute force signal set from ALL failure rows (not just company rows)
  const allFailures = allRows.filter(r => !r.success);
  const bruteForceIPs = buildBruteForceIPSet(allFailures);

  // Group by companyId
  const byCompany = new Map<number, { failures: number; successes: number; ips: Set<string> }>();
  for (const r of companyRows) {
    const cid   = r.companyId as number;
    const entry = byCompany.get(cid) ?? { failures: 0, successes: 0, ips: new Set<string>() };
    r.success ? entry.successes++ : entry.failures++;
    entry.ips.add(r.ip);
    byCompany.set(cid, entry);
  }

  const results: AccountRiskResult[] = [];
  for (const [companyId, data] of byCompany) {
    const bruteForceSignal = [...data.ips].some(ip => bruteForceIPs.has(ip));
    const breakdown: RiskBreakdown = {
      failedLogins:     data.failures,
      successLogins:    data.successes,
      ipDiversity:      data.ips.size,
      targetSpread:     data.ips.size,
      bruteForceSignal,
    };
    results.push({ companyId, riskScore: deriveScore(breakdown), breakdown });
  }

  return results.sort((a, b) => b.riskScore - a.riskScore);
}

/**
 * Compute risk for a single account (point lookup).
 * Makes one company-scoped fetch, then one global failure fetch to detect
 * brute force — two queries total via AuthReadService.
 */
export async function computeAccountRisk(
  companyId?: number,
  userId?: number,
): Promise<AccountRiskResult | null> {
  if (!companyId && !userId) return null;

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60_000);

  const filters = companyId ? { companyId } : { userId: userId! };
  const rows = await getAuthAttempts({ ...filters, from: since7d, limit: 1_000 });
  if (rows.length === 0) return null;

  // Detect brute force: check which of this account's IPs also hit other accounts
  const accountIPs = new Set(rows.map(r => r.ip));
  const allFailures7d = await getAuthAttempts({ from: since7d, success: false, limit: 5_000 });
  const bruteForceIPs = buildBruteForceIPSet(allFailures7d);
  const bruteForceSignal = [...accountIPs].some(ip => bruteForceIPs.has(ip));

  const failures  = rows.filter(r => !r.success).length;
  const successes = rows.filter(r =>  r.success).length;

  const breakdown: RiskBreakdown = {
    failedLogins:     failures,
    successLogins:    successes,
    ipDiversity:      accountIPs.size,
    targetSpread:     accountIPs.size,
    bruteForceSignal,
  };

  return {
    companyId: companyId ?? 0,
    riskScore:  deriveScore(breakdown),
    breakdown,
  };
}
