/**
 * FASE 14.8 — Security Observability Panel: DB-backed risk intelligence.
 * FASE 14.10 — Refactored to use AuthReadService as the single read path.
 * FASE 14.11 — Extended response with anomaly detection results.
 *
 * GET /api/admin/security/overview
 *
 * All auth_attempts reads go through AuthReadService (FASE 14.10).
 * Anomaly detection runs in parallel with stats computation (FASE 14.11).
 * No direct Drizzle queries in this file.
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
} from "../core/security/authRead.service";
import { detectAnomalies } from "../core/security/anomalyDetection.service";

interface HourBucket {
  hour:      number;
  label:     string;
  failures:  number;
  successes: number;
}

async function buildOverview() {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60_000);

  // Run stats fetch and anomaly detection in parallel — both use AuthReadService
  const [allRows, anomalyReport] = await Promise.all([
    getAuthAttempts({ from: since30d }),
    detectAnomalies(),
  ]);

  const now    = Date.now();
  const cut24h = now - 24 * 60 * 60_000;
  const cut7d  = now -  7 * 24 * 60 * 60_000;

  const rows24h = allRows.filter(r => r.createdAt.getTime() >= cut24h);
  const rows7d  = allRows.filter(r => r.createdAt.getTime() >= cut7d);

  // ── Stats via AuthReadService pure fn ───────────────────────────────────
  const s24h = computeAuthStats(rows24h);
  const s7d  = computeAuthStats(rows7d);
  const s30d = computeAuthStats(allRows);

  const stats = {
    failures24h:    s24h.failureCount,
    successes24h:   s24h.successCount,
    total24h:       s24h.totalAttempts,
    successRate24h: s24h.totalAttempts === 0
      ? 100
      : Math.round((s24h.successCount / s24h.totalAttempts) * 100),
    failures7d:     s7d.failureCount,
    failures30d:    s30d.failureCount,
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

  // ── Top attacker IPs (7d failures) via AuthReadService pure fn ──────────
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

  // ── Recent activity feed (last 20 rows) ─────────────────────────────────
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
    // FASE 14.11 — anomaly detection (derived intelligence, not a system)
    anomalies: anomalyReport,
    generatedAt: new Date().toISOString(),
  };
}

function emptyOverview(errorMsg?: string) {
  return {
    stats: {
      failures24h: 0, successes24h: 0, total24h: 0,
      successRate24h: 100, failures7d: 0, failures30d: 0,
    },
    hourlyTimeline: Array.from({ length: 24 }, (_, h) => ({
      hour: h, label: `${String(h).padStart(2, "0")}h`, failures: 0, successes: 0,
    })),
    topAttackerIPs:    [],
    bruteForceCluster: [],
    topRiskyAccounts:  [],
    recentActivity:    [],
    anomalies: {
      generatedAt: new Date().toISOString(),
      window: "24h",
      globalRiskSignal: 0,
      anomalies: [],
    },
    generatedAt: new Date().toISOString(),
    _error: errorMsg,
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
