/**
 * FASE 7.2 — Intelligent Risk Detection.
 *
 * Pure-analysis layer — reads events from securityLogger and classifies
 * behaviour. Never blocks, never writes to DB, never modifies routes.
 *
 * Exported API:
 *   analyzeSecurity()  — per-IP stats + risk classification
 *   detectSpike()      — short-window event burst detection
 */

import { getSecurityEvents } from "./securityLogger";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface IPAnalysis {
  ip: string;
  total: number;
  rateLimit: number;
  highRisk: number;
  critical: number;
  risk: RiskLevel;
}

export interface SpikeReport {
  lastMinuteEvents: number;
  spike: boolean;
}

// ── Risk scoring ──────────────────────────────────────────────────────────────

/**
 * Classify an IP based on its raw event counters.
 *
 * Thresholds (tunable without any DB or restart):
 *   CRITICAL  — ≥5 critical actions, OR ≥20 rate-limit blocks + ≥1 critical
 *   HIGH      — ≥3 critical actions, OR ≥10 rate-limit blocks
 *   MEDIUM    — ≥1 critical action, OR ≥5 rate-limit blocks
 *   LOW       — everything else
 */
function classify(rateLimit: number, critical: number): RiskLevel {
  if (critical >= 5 || (rateLimit >= 20 && critical >= 1)) return "CRITICAL";
  if (critical >= 3 || rateLimit >= 10) return "HIGH";
  if (critical >= 1 || rateLimit >= 5) return "MEDIUM";
  return "LOW";
}

// ── Analyzer ──────────────────────────────────────────────────────────────────

/**
 * Aggregate all in-memory security events by IP, compute per-event-type
 * counts, and assign a risk level.
 *
 * Returns results sorted by total event count descending (highest-activity
 * IPs first) so callers can slice to top-N without additional sorting.
 */
export function analyzeSecurity(): IPAnalysis[] {
  const events = getSecurityEvents();

  const map: Record<
    string,
    { total: number; rateLimit: number; highRisk: number; critical: number }
  > = {};

  for (const e of events) {
    if (!e.ip) continue;

    if (!map[e.ip]) {
      map[e.ip] = { total: 0, rateLimit: 0, highRisk: 0, critical: 0 };
    }

    map[e.ip].total++;

    if (e.type === "RATE_LIMITED") map[e.ip].rateLimit++;
    else if (e.type === "HIGH_RISK_ACTION") map[e.ip].highRisk++;
    else if (e.type === "CRITICAL_ACTION") map[e.ip].critical++;
  }

  return Object.entries(map)
    .map(([ip, stats]) => ({
      ip,
      ...stats,
      risk: classify(stats.rateLimit, stats.critical),
    }))
    .sort((a, b) => b.total - a.total);
}

// ── Spike detector ────────────────────────────────────────────────────────────

/**
 * Count events that occurred in the last 60 seconds and flag a spike if
 * that count exceeds the threshold (default 50).
 *
 * Used as a lightweight "is something happening right now?" signal without
 * needing a time-series DB.
 */
export function detectSpike(thresholdPerMinute = 50): SpikeReport {
  const events = getSecurityEvents();
  const since = Date.now() - 60_000;
  const recent = events.filter((e) => e.timestamp > since);

  return {
    lastMinuteEvents: recent.length,
    spike: recent.length > thresholdPerMinute,
  };
}
