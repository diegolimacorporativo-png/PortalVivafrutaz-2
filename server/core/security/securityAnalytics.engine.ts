/**
 * FASE 14.X — Security Analytics Engine: the single brain of the security layer.
 *
 * ONE fetch. ONE computation pass. ONE unified report.
 *
 * Replaces (and is delegated to by):
 *   • RiskDerivationService   — per-company risk scores
 *   • AnomalyDetectionService — brute force, spike, volatility, cluster
 *   • security-overview route — stats, timeline, attackers, recent activity
 *
 * Architecture:
 *   auth_attempts (DB)
 *         ↓ ONE read via AuthReadService
 *   SecurityAnalyticsEngine
 *         ↓ single report object
 *   ├── /api/admin/security/overview
 *   └── /api/admin/security/risk
 *
 * RULES:
 *  • ZERO direct DB queries — all reads go through AuthReadService.
 *  • ZERO side effects — 100% read-only.
 *  • ZERO duplicated logic between risk, anomaly, and stats layers.
 *  • Fail-open: errors return an empty-but-valid report.
 *
 * PRINCIPLE: "There is only ONE security brain. Everything is derived from it."
 */

import {
  getAuthAttempts,
  computeAuthStats,
  computeTopAttackers,
  type NormalizedAttempt,
  type AttackerInfo,
} from "./authRead.service";

// ── Shared types ─────────────────────────────────────────────────────────────

export interface WindowStats {
  total:       number;
  successes:   number;
  failures:    number;
  uniqueIPs:   number;
  /** 0–100 integer */
  successRate: number;
}

export interface HourBucket {
  hour:      number;
  label:     string;
  failures:  number;
  successes: number;
}

export interface CompanyRisk {
  companyId: number;
  riskScore:  number;
  breakdown: {
    failedLogins:     number;
    successLogins:    number;
    ipDiversity:      number;
    targetSpread:     number;
    bruteForceSignal: boolean;
  };
}

export type AnomalyType     = "BRUTE_FORCE" | "SPIKE" | "IP_VOLATILITY" | "CLUSTER";
export type AnomalySeverity = "low" | "medium" | "high";

export interface Anomaly {
  type:             AnomalyType;
  severity:         AnomalySeverity;
  score:            number;
  affectedEntities: string[];
  evidence:         Record<string, unknown>;
}

export interface RiskyAccount {
  type:     "admin" | "company";
  id:       number;
  failures: number;
}

export interface RecentEntry {
  userId:    number | null;
  companyId: number | null;
  ip:        string;
  endpoint:  string | null;
  success:   boolean;
  createdAt: string;
}

export interface SecurityAnalyticsReport {
  generatedAt: string;

  /** Multi-window aggregated stats */
  stats: {
    window24h: WindowStats;
    window7d:  WindowStats;
    window30d: WindowStats;
  };

  /** Global risk signal derived from anomaly scores */
  risk: {
    /** 0–100 — sum of anomaly scores capped at 100 */
    globalScore: number;
    level:       "low" | "medium" | "high";
  };

  /** Per-company risk breakdowns */
  companyRisks: CompanyRisk[];

  /** Anomaly detection results */
  anomalies: {
    generatedAt:      string;
    window:           "24h";
    globalRiskSignal: number;
    anomalies:        Anomaly[];
  };

  /** Top attacking IPs ranked by aggressiveness */
  attackers: AttackerInfo[];

  /** Brute force IPs (targetsCount >= 2), subset of attackers */
  bruteForceCluster: { ip: string; failures: number; targetsCount: number }[];

  /** Top risky accounts by failure count (7d) */
  topRiskyAccounts: RiskyAccount[];

  /** Hourly failure/success buckets for the last 24h */
  timeline: HourBucket[];

  /** Latest 20 auth attempts (newest first) */
  recentActivity: RecentEntry[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function toWindowStats(rows: NormalizedAttempt[]): WindowStats {
  const stats = computeAuthStats(rows);
  return {
    total:       stats.totalAttempts,
    successes:   stats.successCount,
    failures:    stats.failureCount,
    uniqueIPs:   stats.uniqueIPs,
    successRate: stats.failureRate === 100 ? 0 : 100 - stats.failureRate,
  };
}

function accountKey(r: NormalizedAttempt): string | null {
  if (r.companyId) return `company:${r.companyId}`;
  if (r.userId)    return `user:${r.userId}`;
  return null;
}

function anomalySeverity(score: number): AnomalySeverity {
  if (score >= 25) return "high";
  if (score >= 15) return "medium";
  return "low";
}

// ── Risk score formula (per-company, 0–100) ───────────────────────────────────

function companyRiskScore(bd: CompanyRisk["breakdown"]): number {
  let s = 0;
  s += Math.min(bd.failedLogins  * 4, 40);
  s += Math.min((bd.ipDiversity - 1) * 5, 20);
  if (bd.bruteForceSignal) s += 25;
  s += Math.min(bd.targetSpread * 3, 15);
  return Math.min(Math.max(s, 0), 100);
}

// ── Anomaly detectors (pure — operate on pre-fetched rows) ───────────────────

function detectBruteForce(failures: NormalizedAttempt[]): Anomaly[] {
  const out: Anomaly[] = [];

  // (a) 1 IP → 2+ accounts
  const ipToAcct = new Map<string, Set<string>>();
  for (const r of failures) {
    const key = accountKey(r);
    if (!key) continue;
    const s = ipToAcct.get(r.ip) ?? new Set<string>();
    s.add(key);
    ipToAcct.set(r.ip, s);
  }
  const distributedIPs = [...ipToAcct.entries()].filter(([, a]) => a.size >= 2);
  for (const [ip, accts] of distributedIPs) {
    out.push({
      type: "BRUTE_FORCE", severity: "high", score: 30,
      affectedEntities: [...accts],
      evidence: { pattern: "distributed_ip", ip, accountsCount: accts.size, accounts: [...accts] },
    });
  }

  // (b) 1 account ← 3+ IPs (only if not already in (a))
  const acctToIP = new Map<string, Set<string>>();
  for (const r of failures) {
    const key = accountKey(r);
    if (!key) continue;
    const s = acctToIP.get(key) ?? new Set<string>();
    s.add(r.ip);
    acctToIP.set(key, s);
  }
  const coveredIPs = new Set(distributedIPs.map(([ip]) => ip));
  for (const [acct, ips] of acctToIP) {
    if (ips.size < 3) continue;
    if ([...ips].some(ip => coveredIPs.has(ip))) continue;
    out.push({
      type: "BRUTE_FORCE", severity: "high", score: 30,
      affectedEntities: [acct],
      evidence: { pattern: "concentrated_account", account: acct, ipCount: ips.size, sampleIPs: [...ips].slice(0, 5) },
    });
  }
  return out;
}

function detectSpike(failures24h: NormalizedAttempt[], failures7d: NormalizedAttempt[]): Anomaly[] {
  const cut1h = Date.now() - 60 * 60_000;
  const count1h    = failures24h.filter(r => r.createdAt.getTime() >= cut1h).length;
  const avgHourly7d = failures7d.length / 168;

  if (avgHourly7d < 1 && count1h < 5) return [];
  if (count1h <= avgHourly7d * 3)      return [];

  const multiplier = avgHourly7d > 0 ? Math.round(count1h / avgHourly7d) : count1h;
  return [{
    type: "SPIKE", severity: multiplier >= 10 ? "high" : "medium", score: 25,
    affectedEntities: [...new Set(failures24h.filter(r => r.createdAt.getTime() >= cut1h).map(r => r.ip))],
    evidence: { last1hFailures: count1h, avgHourlyBaseline: Math.round(avgHourly7d * 10) / 10, multiplier },
  }];
}

function detectIPVolatility(rows24h: NormalizedAttempt[]): Anomaly[] {
  const acctToIPs = new Map<string, Set<string>>();
  for (const r of rows24h) {
    const key = accountKey(r);
    if (!key) continue;
    const s = acctToIPs.get(key) ?? new Set<string>();
    s.add(r.ip);
    acctToIPs.set(key, s);
  }
  const out: Anomaly[] = [];
  for (const [acct, ips] of acctToIPs) {
    if (ips.size < 3) continue;
    out.push({
      type: "IP_VOLATILITY", severity: ips.size >= 5 ? "high" : "medium", score: 20,
      affectedEntities: [acct],
      evidence: { account: acct, distinctIPs: ips.size, sampleIPs: [...ips].slice(0, 5) },
    });
  }
  return out;
}

function detectCluster(failures24h: NormalizedAttempt[]): Anomaly[] {
  if (failures24h.length < 5) return [];
  const sorted = [...failures24h].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const WINDOW = 5 * 60_000;
  const out: Anomaly[] = [];
  const seen = new Set<number>();
  for (const r of sorted) {
    const ws = r.createdAt.getTime();
    const slot = Math.floor(ws / WINDOW);
    if (seen.has(slot)) continue;
    const bucket = sorted.filter(x => x.createdAt.getTime() >= ws && x.createdAt.getTime() <= ws + WINDOW);
    if (bucket.length < 5) continue;
    seen.add(slot);
    const ips   = [...new Set(bucket.map(x => x.ip))];
    const accts = [...new Set(bucket.map(x => accountKey(x)).filter(Boolean))] as string[];
    out.push({
      type: "CLUSTER", severity: bucket.length >= 10 ? "high" : "medium", score: 10,
      affectedEntities: [...ips, ...accts],
      evidence: {
        windowStart:  new Date(ws).toISOString(),
        windowEnd:    new Date(ws + WINDOW).toISOString(),
        failureCount: bucket.length,
        distinctIPs:  ips.length,
      },
    });
  }
  return out;
}

// ── Main engine ───────────────────────────────────────────────────────────────

const EMPTY_WINDOW_STATS: WindowStats = { total: 0, successes: 0, failures: 0, uniqueIPs: 0, successRate: 100 };

function emptyReport(): SecurityAnalyticsReport {
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    stats: { window24h: EMPTY_WINDOW_STATS, window7d: EMPTY_WINDOW_STATS, window30d: EMPTY_WINDOW_STATS },
    risk: { globalScore: 0, level: "low" },
    companyRisks: [],
    anomalies: { generatedAt: now, window: "24h", globalRiskSignal: 0, anomalies: [] },
    attackers: [], bruteForceCluster: [], topRiskyAccounts: [], timeline: [],
    recentActivity: [],
  };
}

/**
 * Run the full security analytics pipeline over the last `windowDays` days.
 *
 * ONE DB fetch → ONE computation pass → ONE unified report.
 *
 * @param windowDays How many days of history to load (default 30).
 */
export async function runSecurityAnalytics(windowDays = 30): Promise<SecurityAnalyticsReport> {
  try {
    const since30d = new Date(Date.now() - windowDays * 24 * 60 * 60_000);
    const since7d  = new Date(Date.now() -  7 * 24 * 60 * 60_000);

    // ── Single DB fetch via AuthReadService ──────────────────────────────
    // 30d window covers everything; 7d failures fetched separately for spike
    // baseline (kept lean with success: false + limit cap).
    const [allRows, failures7dBaseline] = await Promise.all([
      getAuthAttempts({ from: since30d }),
      getAuthAttempts({ from: since7d, success: false, limit: 2_000 }),
    ]);

    const now    = Date.now();
    const cut24h = now - 24 * 60 * 60_000;
    const cut7d  = now -  7 * 24 * 60 * 60_000;

    // ── Window slices (pure JS, no extra DB hits) ─────────────────────────
    const rows24h = allRows.filter(r => r.createdAt.getTime() >= cut24h);
    const rows7d  = allRows.filter(r => r.createdAt.getTime() >= cut7d);

    const failures24h = rows24h.filter(r => !r.success);
    const failures7d  = rows7d.filter(r => !r.success);

    // ── Stats ─────────────────────────────────────────────────────────────
    const stats = {
      window24h: toWindowStats(rows24h),
      window7d:  toWindowStats(rows7d),
      window30d: toWindowStats(allRows),
    };

    // ── Hourly timeline (24 buckets, hour-of-day key) ─────────────────────
    const hourlyMap = new Map<number, HourBucket>();
    for (let h = 0; h < 24; h++) {
      hourlyMap.set(h, { hour: h, label: `${String(h).padStart(2, "0")}h`, failures: 0, successes: 0 });
    }
    for (const r of rows24h) {
      const b = hourlyMap.get(r.createdAt.getHours())!;
      r.success ? b.successes++ : b.failures++;
    }
    const timeline: HourBucket[] = Array.from(hourlyMap.values());

    // ── Attackers + brute force cluster ───────────────────────────────────
    const attackers = computeTopAttackers(failures7d).slice(0, 20);
    const bruteForceCluster = attackers
      .filter(a => a.targetsCount >= 2)
      .map(a => ({ ip: a.ip, failures: a.failures, targetsCount: a.targetsCount }));

    // ── Brute force IP set (shared by both anomaly detector and company risk) ─
    const bruteForceIPs = new Set(bruteForceCluster.map(c => c.ip));

    // ── Per-company risks ─────────────────────────────────────────────────
    const byCompany = new Map<number, { failures: number; successes: number; ips: Set<string> }>();
    for (const r of allRows.filter(r => r.companyId !== null)) {
      const cid   = r.companyId as number;
      const entry = byCompany.get(cid) ?? { failures: 0, successes: 0, ips: new Set<string>() };
      r.success ? entry.successes++ : entry.failures++;
      entry.ips.add(r.ip);
      byCompany.set(cid, entry);
    }
    const companyRisks: CompanyRisk[] = [];
    for (const [companyId, data] of byCompany) {
      const bd = {
        failedLogins:     data.failures,
        successLogins:    data.successes,
        ipDiversity:      data.ips.size,
        targetSpread:     data.ips.size,
        bruteForceSignal: [...data.ips].some(ip => bruteForceIPs.has(ip)),
      };
      companyRisks.push({ companyId, riskScore: companyRiskScore(bd), breakdown: bd });
    }
    companyRisks.sort((a, b) => b.riskScore - a.riskScore);

    // ── Anomaly detection (pure JS on sliced rows) ────────────────────────
    const detectedAnomalies: Anomaly[] = [
      ...detectBruteForce(failures24h),
      ...detectSpike(failures24h, failures7dBaseline),
      ...detectIPVolatility(rows24h),
      ...detectCluster(failures24h),
    ];
    const anomalySignal = Math.min(detectedAnomalies.reduce((s, a) => s + a.score, 0), 100);

    // ── Global risk ───────────────────────────────────────────────────────
    const globalScore = anomalySignal;
    const riskLevel   = globalScore >= 61 ? "high" : globalScore >= 26 ? "medium" : "low";

    // ── Top risky accounts (7d failures) ─────────────────────────────────
    const acctMap = new Map<string, RiskyAccount>();
    for (const r of failures7d) {
      if (r.userId) {
        const k = `user:${r.userId}`;
        const e = acctMap.get(k) ?? { type: "admin" as const, id: r.userId, failures: 0 };
        e.failures++;
        acctMap.set(k, e);
      } else if (r.companyId) {
        const k = `company:${r.companyId}`;
        const e = acctMap.get(k) ?? { type: "company" as const, id: r.companyId, failures: 0 };
        e.failures++;
        acctMap.set(k, e);
      }
    }
    const topRiskyAccounts = [...acctMap.values()].sort((a, b) => b.failures - a.failures).slice(0, 10);

    // ── Recent activity (last 20 rows) ────────────────────────────────────
    const recentActivity: RecentEntry[] = allRows.slice(0, 20).map(r => ({
      userId:    r.userId,
      companyId: r.companyId,
      ip:        r.ip,
      endpoint:  r.endpoint,
      success:   r.success,
      createdAt: r.createdAt.toISOString(),
    }));

    return {
      generatedAt: new Date().toISOString(),
      stats,
      risk: { globalScore, level: riskLevel },
      companyRisks,
      anomalies: {
        generatedAt:      new Date().toISOString(),
        window:           "24h",
        globalRiskSignal: anomalySignal,
        anomalies:        detectedAnomalies,
      },
      attackers,
      bruteForceCluster,
      topRiskyAccounts,
      timeline,
      recentActivity,
    };
  } catch {
    return emptyReport();
  }
}
