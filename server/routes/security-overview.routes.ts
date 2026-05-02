/**
 * FASE 14.8 — Security Observability Panel: DB-backed risk intelligence.
 *
 * Complements the existing in-memory endpoints (FASE 7.x):
 *   GET /api/admin/security/events    → in-memory circular buffer
 *   GET /api/admin/security/analysis  → in-memory IP fraud scores
 *
 * This endpoint queries auth_attempts (PostgreSQL) for:
 *   - Historical attack stats (24h / 7d / 30d windows)
 *   - Top risky accounts (userId / companyId with most failures)
 *   - Top attacker IPs ranked by failure volume + distinct targets
 *   - Hourly timeline (24 buckets for the last 24h)
 *   - Brute force clusters (IPs targeting 2+ distinct accounts)
 *
 * Fail-open: any DB error returns empty but valid structure so the
 * dashboard doesn't crash.
 *
 * Protected: MASTER and ADMIN roles only.
 */

import type { Express, Request, Response } from "express";
import { desc, gte } from "drizzle-orm";
import { db } from "../database/db";
import { authAttempts } from "../../shared/schema";
import { requireAuth, requireRole } from "../core/http/requireAuth";

interface AccountRisk {
  type: "admin" | "company";
  id: number;
  failures: number;
}

interface IPStat {
  ip: string;
  failures: number;
  targetsCount: number;
}

interface HourBucket {
  hour: number;
  label: string;
  failures: number;
  successes: number;
}

async function buildOverview() {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60_000);

  // Single query covers all windows (30d max). Capped at 5 000 rows for safety.
  const rows = await db
    .select({
      success: authAttempts.success,
      createdAt: authAttempts.createdAt,
      ip: authAttempts.ip,
      userId: authAttempts.userId,
      companyId: authAttempts.companyId,
      endpoint: authAttempts.endpoint,
    })
    .from(authAttempts)
    .where(gte(authAttempts.createdAt, since30d))
    .orderBy(desc(authAttempts.createdAt))
    .limit(5_000);

  const now = Date.now();
  const cutoff24h = now - 24 * 60 * 60_000;
  const cutoff7d  = now - 7 * 24 * 60 * 60_000;

  // ── Window buckets ──────────────────────────────────────────────────────
  const attempts24h = rows.filter(r => r.createdAt.getTime() >= cutoff24h);
  const attempts7d  = rows.filter(r => r.createdAt.getTime() >= cutoff7d);

  const failures24h = attempts24h.filter(r => !r.success).length;
  const successes24h = attempts24h.filter(r => r.success).length;
  const total24h = attempts24h.length;

  const failures7d  = attempts7d.filter(r => !r.success).length;
  const failures30d = rows.filter(r => !r.success).length;

  const successRate24h = total24h === 0 ? 100 : Math.round((successes24h / total24h) * 100);

  // ── Hourly timeline (last 24 h — 24 buckets keyed by hour-of-day) ──────
  const hourlyMap = new Map<number, HourBucket>();
  for (let h = 0; h < 24; h++) {
    hourlyMap.set(h, { hour: h, label: `${String(h).padStart(2, "0")}h`, failures: 0, successes: 0 });
  }
  for (const r of attempts24h) {
    const h = r.createdAt.getHours();
    const bucket = hourlyMap.get(h)!;
    if (r.success) bucket.successes++;
    else           bucket.failures++;
  }
  // Return in ascending hour order
  const hourlyTimeline: HourBucket[] = Array.from(hourlyMap.values());

  // ── Top attacker IPs (from failures in last 7 d) ────────────────────────
  const failures7dRows = attempts7d.filter(r => !r.success);
  const ipMap = new Map<string, { failures: number; targets: Set<string> }>();
  for (const r of failures7dRows) {
    const entry = ipMap.get(r.ip) ?? { failures: 0, targets: new Set<string>() };
    entry.failures++;
    if (r.userId)    entry.targets.add(`user:${r.userId}`);
    if (r.companyId) entry.targets.add(`company:${r.companyId}`);
    ipMap.set(r.ip, entry);
  }
  const topAttackerIPs: IPStat[] = Array.from(ipMap.entries())
    .map(([ip, d]) => ({ ip, failures: d.failures, targetsCount: d.targets.size }))
    .sort((a, b) => b.failures - a.failures)
    .slice(0, 10);

  // ── Brute force clusters — IPs targeting 2+ distinct accounts ──────────
  const bruteForceCluster = topAttackerIPs.filter(x => x.targetsCount >= 2);

  // ── Top risky accounts (by failure volume, last 7 d) ───────────────────
  const accountMap = new Map<string, AccountRisk>();
  for (const r of failures7dRows) {
    if (r.userId) {
      const key = `user:${r.userId}`;
      const entry = accountMap.get(key) ?? { type: "admin" as const, id: r.userId, failures: 0 };
      entry.failures++;
      accountMap.set(key, entry);
    } else if (r.companyId) {
      const key = `company:${r.companyId}`;
      const entry = accountMap.get(key) ?? { type: "company" as const, id: r.companyId, failures: 0 };
      entry.failures++;
      accountMap.set(key, entry);
    }
  }
  const topRiskyAccounts: AccountRisk[] = Array.from(accountMap.values())
    .sort((a, b) => b.failures - a.failures)
    .slice(0, 10);

  // ── Recent activity feed (last 20 rows regardless of success) ──────────
  const recentActivity = rows.slice(0, 20).map(r => ({
    userId:    r.userId,
    companyId: r.companyId,
    ip:        r.ip,
    endpoint:  r.endpoint,
    success:   r.success,
    createdAt: r.createdAt.toISOString(),
  }));

  return {
    stats: {
      failures24h,
      successes24h,
      total24h,
      successRate24h,
      failures7d,
      failures30d,
    },
    hourlyTimeline,
    topAttackerIPs,
    bruteForceCluster,
    topRiskyAccounts,
    recentActivity,
    generatedAt: new Date().toISOString(),
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
        // Fail-open: return empty structure so the dashboard doesn't crash
        return res.json({
          success: true,
          data: {
            stats: { failures24h: 0, successes24h: 0, total24h: 0, successRate24h: 100, failures7d: 0, failures30d: 0 },
            hourlyTimeline: Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${String(h).padStart(2, "0")}h`, failures: 0, successes: 0 })),
            topAttackerIPs: [],
            bruteForceCluster: [],
            topRiskyAccounts: [],
            recentActivity: [],
            generatedAt: new Date().toISOString(),
            _error: err?.message ?? "unknown",
          },
        });
      }
    },
  );
}
