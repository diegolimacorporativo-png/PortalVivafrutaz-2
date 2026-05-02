/**
 * FASE 14.8 — Security Observability Panel: DB-backed risk intelligence.
 * FASE 14.10 — Refactored to use AuthReadService as the single read path.
 *
 * All auth_attempts reads now go through AuthReadService. No direct Drizzle
 * queries live in this file.
 *
 * GET /api/admin/security/overview
 *
 * Computes from a single 30d fetch:
 *   - Stats: 24h / 7d / 30d windows
 *   - Hourly timeline (24 buckets for the last 24h)
 *   - Top attacker IPs by failure volume + distinct targets
 *   - Brute force clusters (IPs targeting ≥ 2 accounts)
 *   - Top risky accounts
 *   - Recent activity feed (last 20 rows)
 *
 * Fail-open: any error returns empty but valid structure.
 * Protected: MASTER and ADMIN roles only.
 */

import type { Express, Request, Response } from "express";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import {
  getAuthAttempts,
  computeAuthStats,
  computeTopAttackers,
  type NormalizedAttempt,
} from "../core/security/authRead.service";

interface HourBucket {
  hour:     number;
  label:    string;
  failures: number;
  successes: number;
}

async function buildOverview() {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60_000);

  // Single DB fetch via AuthReadService covers all windows (cap: 5 000 rows)
  const allRows = await getAuthAttempts({ from: since30d });

  const now      = Date.now();
  const cut24h   = now - 24 * 60 * 60_000;
  const cut7d    = now -  7 * 24 * 60 * 60_000;

  const rows24h = allRows.filter(r => r.createdAt.getTime() >= cut24h);
  const rows7d  = allRows.filter(r => r.createdAt.getTime() >= cut7d);

  // ── Stats ───────────────────────────────────────────────────────────────
  const stats24h  = computeAuthStats(rows24h);
  const stats7d   = computeAuthStats(rows7d);
  const stats30d  = computeAuthStats(allRows);

  const stats = {
    failures24h:    stats24h.failureCount,
    successes24h:   stats24h.successCount,
    total24h:       stats24h.totalAttempts,
    successRate24h: stats24h.totalAttempts === 0
      ? 100
      : Math.round((stats24h.successCount / stats24h.totalAttempts) * 100),
    failures7d:     stats7d.failureCount,
    failures30d:    stats30d.failureCount,
  };

  // ── Hourly timeline (24 buckets, hour-of-day) ───────────────────────────
  const hourlyMap = new Map<number, HourBucket>();
  for (let h = 0; h < 24; h++) {
    hourlyMap.set(h, { hour: h, label: `${String(h).padStart(2, "0")}h`, failures: 0, successes: 0 });
  }
  for (const r of rows24h) {
    const bucket = hourlyMap.get(r.createdAt.getHours())!;
    r.success ? bucket.successes++ : bucket.failures++;
  }
  const hourlyTimeline: HourBucket[] = Array.from(hourlyMap.values());

  // ── Top attacker IPs (7d failures, via AuthReadService pure fn) ─────────
  const failures7dRows = rows7d.filter(r => !r.success);
  const attackers = computeTopAttackers(failures7dRows);

  const topAttackerIPs = attackers
    .slice(0, 10)
    .map(a => ({ ip: a.ip, failures: a.failures, targetsCount: a.targetsCount }));

  const bruteForceCluster = topAttackerIPs.filter(x => x.targetsCount >= 2);

  // ── Top risky accounts (7d failures grouped by account) ─────────────────
  const accountMap = new Map<string, { type: "admin" | "company"; id: number; failures: number }>();
  for (const r of failures7dRows) {
    if (r.userId) {
      const key   = `user:${r.userId}`;
      const entry = accountMap.get(key) ?? { type: "admin" as const, id: r.userId, failures: 0 };
      entry.failures++;
      accountMap.set(key, entry);
    } else if (r.companyId) {
      const key   = `company:${r.companyId}`;
      const entry = accountMap.get(key) ?? { type: "company" as const, id: r.companyId, failures: 0 };
      entry.failures++;
      accountMap.set(key, entry);
    }
  }
  const topRiskyAccounts = Array.from(accountMap.values())
    .sort((a, b) => b.failures - a.failures)
    .slice(0, 10);

  // ── Recent activity feed (last 20 rows regardless of success) ───────────
  const recentActivity = allRows.slice(0, 20).map(r => ({
    userId:    r.userId,
    companyId: r.companyId,
    ip:        r.ip,
    endpoint:  r.endpoint,
    success:   r.success,
    createdAt: r.createdAt.toISOString(),
  }));

  return {
    stats,
    hourlyTimeline,
    topAttackerIPs,
    bruteForceCluster,
    topRiskyAccounts,
    recentActivity,
    generatedAt: new Date().toISOString(),
  };
}

/** Empty but valid structure returned on error — dashboard must not crash */
function emptyOverview(errorMsg?: string) {
  return {
    stats: {
      failures24h: 0, successes24h: 0, total24h: 0,
      successRate24h: 100, failures7d: 0, failures30d: 0,
    },
    hourlyTimeline: Array.from({ length: 24 }, (_, h) => ({
      hour: h, label: `${String(h).padStart(2, "0")}h`, failures: 0, successes: 0,
    })),
    topAttackerIPs:   [],
    bruteForceCluster: [],
    topRiskyAccounts: [],
    recentActivity:   [],
    generatedAt:      new Date().toISOString(),
    _error:           errorMsg,
  };
}

export function register(app: Express): void {
  app.get(
    "/api/admin/security/overview",
    requireAuth,
    requireRole(["MASTER", "ADMIN"]),
    async (_req: Request, res: Response) => {
      try {
        const data = await buildOverview();
        return res.json({ success: true, data });
      } catch (err: any) {
        return res.json({ success: true, data: emptyOverview(err?.message ?? "unknown") });
      }
    },
  );
}
