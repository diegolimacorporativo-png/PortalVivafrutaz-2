/**
 * FASE 14.8  — Security Observability Panel.
 * FASE 14.10 — AuthReadService as single read path.
 * FASE 14.11 — Anomaly detection integrated.
 * FASE 14.X  — Unified: delegates 100% to SecurityAnalyticsEngine.
 *
 * GET /api/admin/security/overview
 *
 * This route is now a THIN ADAPTER over SecurityAnalyticsEngine.
 * Zero analytics logic lives here — only HTTP concerns (auth, mapping, error).
 *
 * Protected: MASTER and ADMIN roles only.
 */

import type { Express, Request, Response } from "express";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import { runSecurityAnalytics } from "../core/security/securityAnalytics.engine";

export function register(app: Express): void {
  app.get(
    "/api/admin/security/overview",
    requireAuth,
    requireRole(["MASTER", "ADMIN"]),
    async (_req: Request, res: Response) => {
      const report = await runSecurityAnalytics(30);

      // Map engine report to the existing API contract (backward-compatible)
      const data = {
        stats: {
          failures24h:    report.stats.window24h.failures,
          successes24h:   report.stats.window24h.successes,
          total24h:       report.stats.window24h.total,
          successRate24h: report.stats.window24h.successRate,
          failures7d:     report.stats.window7d.failures,
          failures30d:    report.stats.window30d.failures,
        },
        hourlyTimeline:    report.timeline,
        topAttackerIPs:    report.attackers
          .slice(0, 10)
          .map(a => ({ ip: a.ip, failures: a.failures, targetsCount: a.targetsCount })),
        bruteForceCluster: report.bruteForceCluster,
        topRiskyAccounts:  report.topRiskyAccounts,
        recentActivity:    report.recentActivity,
        // FASE 14.11 — anomaly payload (unchanged shape)
        anomalies:         report.anomalies,
        generatedAt:       report.generatedAt,
      };

      return res.json({ success: true, data });
    },
  );
}
