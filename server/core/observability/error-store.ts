/**
 * FASE 2 — Operational error store.
 *
 * Circular buffer (MAX_ENTRIES) for runtime errors. Follows the same
 * pattern as securityLogger.ts — purely additive, zero DB dependency,
 * never throws. MASTER-only access via /api/admin/observability/errors.
 */

import { randomUUID } from "node:crypto";

export type ErrorSeverity = "ERROR" | "WARN";

export interface ErrorEntry {
  id: string;
  requestId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  tenantId?: number | null;
  actorId?: number;
  role?: string;
  ip?: string;
  timestamp: number;
}

const MAX_ENTRIES = 500;
const entries: ErrorEntry[] = [];

/**
 * Record one operational error. Idempotent — never throws.
 * Fields are trimmed to keep memory predictable.
 */
export function recordError(
  entry: Omit<ErrorEntry, "id" | "timestamp">,
): void {
  try {
    const record: ErrorEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
      stack: entry.stack ? entry.stack.slice(0, 2000) : undefined,
    };
    entries.push(record);
    if (entries.length > MAX_ENTRIES) {
      entries.shift();
    }
  } catch {
    // observability must never break the request path
  }
}

/** Return all entries, newest first. Returns a shallow copy. */
export function getErrors(limit = 200): ErrorEntry[] {
  return [...entries].reverse().slice(0, limit);
}

/** Clear all stored entries. MASTER only. */
export function clearErrors(): void {
  entries.length = 0;
}

/** Total error count since last clear. */
export function errorCount(): number {
  return entries.length;
}
