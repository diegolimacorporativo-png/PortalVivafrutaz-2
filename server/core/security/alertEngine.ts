/**
 * FASE 11 — Operational Alert Engine
 *
 * Observes events pushed via pushAlert(), classifies them by severity,
 * deduplicates within a rolling 60-second window, and exposes the active
 * alert buffer via getAlerts().
 *
 * Rules:
 *   - Pure in-memory (no DB, no I/O)
 *   - Never throws (all errors are swallowed)
 *   - Zero impact on callers — pushAlert is fire-and-forget
 *   - Buffer is capped at MAX_ALERTS to bound memory usage
 */

export type AlertLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AlertEvent {
  id: string;
  type: string;
  level: AlertLevel;
  message: string;
  timestamp: number;
  count: number;
}

// ── Config ────────────────────────────────────────────────────────────────────

const ALERT_WINDOW_MS = 60_000;
const MAX_ALERTS = 200;

// ── Store ─────────────────────────────────────────────────────────────────────

const alertBuffer: Map<string, AlertEvent> = new Map();

// ── Classification ────────────────────────────────────────────────────────────

function classify(type: string): AlertLevel {
  if (type.includes("CRITICAL")) return "CRITICAL";
  if (type.includes("FINANCIAL")) return "CRITICAL";
  if (type.includes("AFTER_CREATE")) return "HIGH";
  if (type.includes("NFE_PREFLIGHT")) return "HIGH";
  if (type.includes("NFE_INVALID")) return "HIGH";
  if (type.includes("NFE_ZERO")) return "HIGH";
  if (type.includes("NFE_EMPTY")) return "HIGH";
  if (type.includes("TENANT_MISMATCH")) return "HIGH";
  if (type.includes("SECURITY")) return "MEDIUM";
  if (type.includes("FAILED")) return "MEDIUM";
  if (type.includes("ERROR")) return "MEDIUM";
  return "LOW";
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Push a security/operational event into the alert buffer.
 * Deduplicates by type within ALERT_WINDOW_MS: if an alert of the same type
 * already exists and has not expired, its count is incremented and its
 * timestamp refreshed. Otherwise a new entry is created.
 *
 * Never throws — callers must not be disrupted by observability code.
 */
export function pushAlert(type: string, message: string): void {
  try {
    const now = Date.now();
    const existing = alertBuffer.get(type);

    if (existing && now - existing.timestamp < ALERT_WINDOW_MS) {
      existing.count += 1;
      existing.timestamp = now;
      existing.message = message;
      return;
    }

    // Enforce cap before inserting
    if (alertBuffer.size >= MAX_ALERTS) {
      // Drop the oldest entry (first key in insertion order)
      const firstKey = alertBuffer.keys().next().value;
      if (firstKey !== undefined) alertBuffer.delete(firstKey);
    }

    alertBuffer.set(type, {
      id: `${type}-${now}`,
      type,
      level: classify(type),
      message,
      timestamp: now,
      count: 1,
    });
  } catch {
    // observability must never break the request path
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Return all active alerts sorted by severity (CRITICAL first) then by
 * most-recent timestamp. Expired alerts (older than ALERT_WINDOW_MS) are
 * evicted before returning.
 */
export function getAlerts(): AlertEvent[] {
  try {
    const now = Date.now();

    // Evict expired
    for (const [key, alert] of alertBuffer.entries()) {
      if (now - alert.timestamp >= ALERT_WINDOW_MS) {
        alertBuffer.delete(key);
      }
    }

    const LEVEL_ORDER: Record<AlertLevel, number> = {
      CRITICAL: 0,
      HIGH: 1,
      MEDIUM: 2,
      LOW: 3,
    };

    return [...alertBuffer.values()].sort((a, b) => {
      const levelDiff = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
      return levelDiff !== 0 ? levelDiff : b.timestamp - a.timestamp;
    });
  } catch {
    return [];
  }
}
