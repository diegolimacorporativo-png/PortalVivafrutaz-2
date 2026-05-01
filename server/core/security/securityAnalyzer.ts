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

// ── FASE 7.3 — Score-based IP intelligence ────────────────────────────────────

/**
 * Event type weights for the anti-fraud score.
 *   RATE_LIMITED    → +5   (automated probing / DDoS)
 *   HIGH_RISK_ACTION → +10  (destructive HTTP verbs on sensitive paths)
 *   CRITICAL_ACTION  → +20  (NF-e emission, cancellation, admin deletes)
 */
const SCORE_WEIGHTS: Record<string, number> = {
  RATE_LIMITED: 5,
  HIGH_RISK_ACTION: 10,
  CRITICAL_ACTION: 20,
};

/** Score thresholds → risk level. */
function scoreToLevel(score: number): RiskLevel {
  if (score > 80) return "CRITICAL";
  if (score > 50) return "HIGH";
  if (score > 20) return "MEDIUM";
  return "LOW";
}

export interface IPScoreBreakdown {
  RATE_LIMITED: number;
  HIGH_RISK_ACTION: number;
  CRITICAL_ACTION: number;
}

export interface IPScore {
  ip: string;
  score: number;
  level: RiskLevel;
  breakdown: IPScoreBreakdown;
  /** FASE 7.3.2 — true when ≥5 scored events occurred in the last 60 s for this IP. */
  spike: boolean;
}

export interface IPScoreReport {
  ips: IPScore[];
  generatedAt: string;
}

/**
 * FASE 7.3 — Compute a numeric fraud-risk score for every IP that appears in
 * the security event buffer.
 *
 * Rules (strictly additive — never blocks, never persists):
 *   RATE_LIMITED     → +5
 *   HIGH_RISK_ACTION → +10
 *   CRITICAL_ACTION  → +20
 *
 * Classification by accumulated score:
 *   LOW      0 – 20
 *   MEDIUM  21 – 50
 *   HIGH    51 – 80
 *   CRITICAL 81+
 *
 * FASE 7.3.1 — Each entry now includes a `breakdown` with the raw event count
 * per type so admins can understand exactly why a score was assigned.
 *
 * Returns IPs sorted by score descending so callers can slice to top-N.
 */
/** Events within this window are counted for per-IP spike detection. */
const SPIKE_WINDOW_MS = 60_000;
/** Minimum scored events in the spike window to flag a spike for an IP. */
const SPIKE_THRESHOLD = 5;

export function computeIPScores(): IPScoreReport {
  const events = getSecurityEvents();
  const since = Date.now() - SPIKE_WINDOW_MS;

  const perIP: Record<
    string,
    { score: number; breakdown: IPScoreBreakdown; recentCount: number }
  > = {};

  for (const e of events) {
    if (!e.ip) continue;
    const weight = SCORE_WEIGHTS[e.type] ?? 0;
    if (weight === 0) continue;

    if (!perIP[e.ip]) {
      perIP[e.ip] = {
        score: 0,
        breakdown: { RATE_LIMITED: 0, HIGH_RISK_ACTION: 0, CRITICAL_ACTION: 0 },
        recentCount: 0,
      };
    }

    perIP[e.ip].score += weight;

    if (e.type === "RATE_LIMITED") perIP[e.ip].breakdown.RATE_LIMITED++;
    else if (e.type === "HIGH_RISK_ACTION") perIP[e.ip].breakdown.HIGH_RISK_ACTION++;
    else if (e.type === "CRITICAL_ACTION") perIP[e.ip].breakdown.CRITICAL_ACTION++;

    // FASE 7.3.2 — count events that fall inside the spike window
    if (e.timestamp > since) perIP[e.ip].recentCount++;
  }

  const ips: IPScore[] = Object.entries(perIP)
    .map(([ip, { score, breakdown, recentCount }]) => ({
      ip,
      score,
      level: scoreToLevel(score),
      breakdown,
      spike: recentCount >= SPIKE_THRESHOLD,
    }))
    .sort((a, b) => b.score - a.score);

  return { ips, generatedAt: new Date().toISOString() };
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
