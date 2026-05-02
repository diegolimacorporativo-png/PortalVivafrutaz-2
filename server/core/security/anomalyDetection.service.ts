/**
 * FASE 14.11 — Real-Time Anomaly Detection (Read-Only Intelligence Layer).
 *
 * Analyses auth_attempts data through AuthReadService to detect attack patterns
 * in near real-time. ZERO persistence, ZERO side effects, ZERO writes.
 *
 * Data flow:
 *   auth_attempts (DB) → AuthReadService → AnomalyDetectionService → overview API
 *
 * RULES (per FASE 14.11 spec):
 *  • Only reads via AuthReadService — no direct DB queries.
 *  • Never persists results.
 *  • Never used to block login or any user action.
 *  • Does not duplicate RiskDerivationService logic.
 *  • Exposed through the existing overview endpoint, not a new one.
 *
 * Anomaly types and score contributions (summed → globalRiskSignal 0–100):
 *   BRUTE_FORCE   +30  — 1 IP hitting 2+ accounts OR 3+ IPs hitting same account
 *   SPIKE         +25  — last-1h failures > 3× the 7d/168h average
 *   IP_VOLATILITY +20  — same account seen from 3+ distinct IPs in 24h
 *   CLUSTER       +10  — any 5-minute window with 5+ failures
 *
 * PRINCIPLE: "Anomaly Detection is derived intelligence, not a system"
 */

import {
  getAuthAttempts,
  computeTopAttackers,
  type NormalizedAttempt,
} from "./authRead.service";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AnomalyType     = "BRUTE_FORCE" | "SPIKE" | "IP_VOLATILITY" | "CLUSTER";
export type AnomalySeverity = "low" | "medium" | "high";

export interface Anomaly {
  type:             AnomalyType;
  severity:         AnomalySeverity;
  score:            number;
  affectedEntities: string[];
  evidence:         Record<string, unknown>;
}

export interface AnomalyReport {
  generatedAt:      string;
  window:           "24h";
  /** Aggregate 0–100 — sum of all anomaly scores, capped at 100 */
  globalRiskSignal: number;
  anomalies:        Anomaly[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function severity(score: number): AnomalySeverity {
  if (score >= 25) return "high";
  if (score >= 15) return "medium";
  return "low";
}

function accountKey(r: NormalizedAttempt): string | null {
  if (r.companyId) return `company:${r.companyId}`;
  if (r.userId)    return `user:${r.userId}`;
  return null;
}

// ── Detectors ─────────────────────────────────────────────────────────────────

/**
 * 3.1 BRUTE_FORCE
 * Triggers when:
 *  (a) a single IP targets 2+ distinct accounts, OR
 *  (b) a single account is targeted by 3+ distinct IPs
 * Score: +30 per attack cluster found.
 */
function detectBruteForce(failures: NormalizedAttempt[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // (a) IP → multiple accounts
  const ipToAccounts = new Map<string, Set<string>>();
  for (const r of failures) {
    const key = accountKey(r);
    if (!key) continue;
    const set = ipToAccounts.get(r.ip) ?? new Set<string>();
    set.add(key);
    ipToAccounts.set(r.ip, set);
  }
  const distributedIPs = [...ipToAccounts.entries()].filter(([, accs]) => accs.size >= 2);
  for (const [ip, accounts] of distributedIPs) {
    anomalies.push({
      type:             "BRUTE_FORCE",
      severity:         "high",
      score:            30,
      affectedEntities: [...accounts],
      evidence: {
        pattern:       "distributed_ip",
        ip,
        accountsCount: accounts.size,
        accounts:      [...accounts],
      },
    });
  }

  // (b) Account ← multiple IPs
  const accountToIPs = new Map<string, Set<string>>();
  for (const r of failures) {
    const key = accountKey(r);
    if (!key) continue;
    const set = accountToIPs.get(key) ?? new Set<string>();
    set.add(r.ip);
    accountToIPs.set(key, set);
  }
  const concentratedAccounts = [...accountToIPs.entries()].filter(([, ips]) => ips.size >= 3);
  for (const [account, ips] of concentratedAccounts) {
    // Avoid double-counting if already caught by (a)
    const alreadyCovered = distributedIPs.some(([ip]) => ips.has(ip));
    if (!alreadyCovered) {
      anomalies.push({
        type:             "BRUTE_FORCE",
        severity:         "high",
        score:            30,
        affectedEntities: [account],
        evidence: {
          pattern:   "concentrated_account",
          account,
          ipCount:   ips.size,
          sampleIPs: [...ips].slice(0, 5),
        },
      });
    }
  }

  return anomalies;
}

/**
 * 3.2 SPIKE
 * Compares last-1h failure count against the 7d/168h hourly average.
 * Triggers when last-1h failures > 3× the baseline average.
 * Score: +25.
 */
function detectSpike(
  failures24h: NormalizedAttempt[],
  failures7d:  NormalizedAttempt[],
): Anomaly[] {
  const cut1h = Date.now() - 60 * 60_000;
  const count1h  = failures24h.filter(r => r.createdAt.getTime() >= cut1h).length;
  const avgHourly7d = failures7d.length / 168; // 7d × 24h

  if (avgHourly7d < 1 && count1h < 5) return []; // not enough history to signal
  if (count1h <= avgHourly7d * 3)      return [];

  const multiplier = avgHourly7d > 0 ? Math.round(count1h / avgHourly7d) : count1h;

  return [{
    type:             "SPIKE",
    severity:         multiplier >= 10 ? "high" : "medium",
    score:            25,
    affectedEntities: [...new Set(failures24h.filter(r => r.createdAt.getTime() >= cut1h).map(r => r.ip))],
    evidence: {
      last1hFailures:    count1h,
      avgHourlyBaseline: Math.round(avgHourly7d * 10) / 10,
      multiplier,
    },
  }];
}

/**
 * 3.3 IP_VOLATILITY
 * Triggers when the same account logs in (or fails) from 3+ distinct IPs
 * within the 24h window.
 * Score: +20 per account.
 */
function detectIPVolatility(rows24h: NormalizedAttempt[]): Anomaly[] {
  const accountToIPs = new Map<string, Set<string>>();
  for (const r of rows24h) {
    const key = accountKey(r);
    if (!key) continue;
    const set = accountToIPs.get(key) ?? new Set<string>();
    set.add(r.ip);
    accountToIPs.set(key, set);
  }

  const anomalies: Anomaly[] = [];
  for (const [account, ips] of accountToIPs) {
    if (ips.size < 3) continue;
    anomalies.push({
      type:             "IP_VOLATILITY",
      severity:         ips.size >= 5 ? "high" : "medium",
      score:            20,
      affectedEntities: [account],
      evidence: {
        account,
        distinctIPs: ips.size,
        sampleIPs:   [...ips].slice(0, 5),
      },
    });
  }
  return anomalies;
}

/**
 * 3.5 CLUSTER
 * Detects bursts of failures within any rolling 5-minute window.
 * Triggers when 5 or more failures fall within a 300-second slice.
 * Score: +10 per cluster found (deduped by window).
 */
function detectCluster(failures24h: NormalizedAttempt[]): Anomaly[] {
  if (failures24h.length < 5) return [];

  const sorted = [...failures24h].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const WINDOW_MS = 5 * 60_000; // 5 minutes
  const anomalies: Anomaly[] = [];
  const reportedWindowStarts = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    const windowStart = sorted[i].createdAt.getTime();
    const windowEnd   = windowStart + WINDOW_MS;
    const bucket      = sorted.filter(r => {
      const t = r.createdAt.getTime();
      return t >= windowStart && t <= windowEnd;
    });

    if (bucket.length < 5) continue;

    // Deduplicate — report only one anomaly per distinct 5-min slot
    const slotKey = Math.floor(windowStart / WINDOW_MS);
    if (reportedWindowStarts.has(slotKey)) continue;
    reportedWindowStarts.add(slotKey);

    const affectedIPs      = [...new Set(bucket.map(r => r.ip))];
    const affectedAccounts = [...new Set(bucket.map(r => accountKey(r)).filter(Boolean))] as string[];

    anomalies.push({
      type:             "CLUSTER",
      severity:         bucket.length >= 10 ? "high" : "medium",
      score:            10,
      affectedEntities: [...affectedIPs, ...affectedAccounts],
      evidence: {
        windowStart:  new Date(windowStart).toISOString(),
        windowEnd:    new Date(windowEnd).toISOString(),
        failureCount: bucket.length,
        distinctIPs:  affectedIPs.length,
      },
    });
  }

  return anomalies;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run all anomaly detectors over the last 24h of auth_attempts data.
 * Returns a structured report with individual anomalies and a 0–100 global
 * risk signal. Fails open — any error returns an empty anomaly list.
 */
export async function detectAnomalies(): Promise<AnomalyReport> {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);
    const since7d  = new Date(Date.now() -  7 * 24 * 60 * 60_000);

    // Two fetches via AuthReadService (24h and 7d) — both are needed:
    // 24h → most detectors, 7d → baseline for SPIKE only
    const [rows24h, rows7d] = await Promise.all([
      getAuthAttempts({ from: since24h }),
      getAuthAttempts({ from: since7d, success: false, limit: 2_000 }),
    ]);

    const failures24h = rows24h.filter(r => !r.success);
    const failures7d  = rows7d; // already filtered to failures

    const anomalies: Anomaly[] = [
      ...detectBruteForce(failures24h),
      ...detectSpike(failures24h, failures7d),
      ...detectIPVolatility(rows24h),
      ...detectCluster(failures24h),
    ];

    const globalRiskSignal = Math.min(
      anomalies.reduce((sum, a) => sum + a.score, 0),
      100,
    );

    return {
      generatedAt:      new Date().toISOString(),
      window:           "24h",
      globalRiskSignal,
      anomalies,
    };
  } catch {
    return {
      generatedAt:      new Date().toISOString(),
      window:           "24h",
      globalRiskSignal: 0,
      anomalies:        [],
    };
  }
}
