/**
 * FASE 7.1 — Centralised in-memory security event store.
 *
 * Architecture decision: purely additive, zero DB dependency, zero impact on
 * existing middleware or route handlers. Every other module CALLS into this
 * one (push); nothing here calls outward. The store is a simple circular
 * buffer: once it reaches MAX_EVENTS the oldest entry is dropped on each
 * new push, keeping memory use bounded.
 *
 * Exported API:
 *   logSecurityEvent(event)  — record one event (idempotent, never throws)
 *   getSecurityEvents()      — return all events (newest first)
 *   getTopIPs(n?)            — return the N IPs with most events
 *   getEventSummary()        — return event counts grouped by type
 *
 * FASE 11: logSecurity() also forwards to alertEngine for operational alerting.
 */

// FASE 11 — import must be at module top-level (ES module hoisting)
import { pushAlert } from "./alertEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SecurityEvent {
  type: string;
  ip?: string;
  userId?: number;
  path?: string;
  requestId?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// ── Store ─────────────────────────────────────────────────────────────────────

const MAX_EVENTS = 1000;
const events: SecurityEvent[] = [];

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Push one security event into the circular buffer.
 * Always succeeds — errors inside (none expected) are swallowed to guarantee
 * callers (middleware) are never disrupted by observability code.
 */
export function logSecurityEvent(event: Omit<SecurityEvent, "timestamp"> & { timestamp?: number }): void {
  try {
    events.push({ ...event, timestamp: event.timestamp ?? Date.now() });
    if (events.length > MAX_EVENTS) {
      events.shift();
    }
  } catch {
    // observability must never break the request path
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Return all stored events, newest first.
 * Returns a shallow copy so callers cannot mutate the internal buffer.
 */
export function getSecurityEvents(): SecurityEvent[] {
  return [...events].reverse();
}

/**
 * Return the top-N IPs ranked by event count, highest first.
 * Only includes events that carry an IP address.
 */
export function getTopIPs(n = 10): Array<{ ip: string; count: number }> {
  const map: Record<string, number> = {};
  for (const e of events) {
    if (!e.ip) continue;
    map[e.ip] = (map[e.ip] ?? 0) + 1;
  }
  return Object.entries(map)
    .map(([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

// ── Centralised security log transport ───────────────────────────────────────

/**
 * Single point of emission for all [SECURITY] console lines.
 *
 * Keeps `console.error` calls out of individual middleware files so
 * future changes (e.g. SIEM integration, log-level filtering) are made
 * in one place. Never throws.
 *
 * FASE 11: also forwards every message to the alert engine so critical
 * operational events become actionable alerts — without altering the
 * existing log behaviour or any caller.
 */
export function logSecurity(message: string): void {
  console.error(message);
  try {
    const typeMatch = message.match(/\[(.*?)\]/);
    const type = typeMatch ? typeMatch[1] : "UNKNOWN";
    pushAlert(type, message);
  } catch {
    // never break the log path
  }
}

/**
 * Return event counts grouped by type, sorted by count descending.
 * Useful for a quick "what is happening" overview in the admin panel.
 */
export function getEventSummary(): Array<{ type: string; count: number }> {
  const map: Record<string, number> = {};
  for (const e of events) {
    map[e.type] = (map[e.type] ?? 0) + 1;
  }
  return Object.entries(map)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}
