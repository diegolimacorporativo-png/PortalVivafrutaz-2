/**
 * FASE 2 — Operational metrics (in-memory, no external dependencies).
 *
 * Simple counters and rolling latency samples. No Prometheus, no push —
 * read on demand via /api/admin/observability/metrics (MASTER only).
 *
 * Latency: keep at most LATENCY_SAMPLES per route to bound memory.
 * requestsByTenant: keyed by tenant ID string.
 */

export interface Metrics {
  totalRequests: number;
  totalErrors: number;
  nfeFailures: number;
  jobFailures: number;
  deadLetterCount: number;
  errorsByRoute: Record<string, number>;
  requestsByTenant: Record<string, number>;
  latencySamplesByRoute: Record<string, number[]>;
  nfeEmissionDurationsMs: number[];
  orderCloseDurationsMs: number[];
  uptimeSince: number;
}

const LATENCY_SAMPLES = 100;
const DURATION_SAMPLES = 200;

const metrics: Metrics = {
  totalRequests: 0,
  totalErrors: 0,
  nfeFailures: 0,
  jobFailures: 0,
  deadLetterCount: 0,
  errorsByRoute: {},
  requestsByTenant: {},
  latencySamplesByRoute: {},
  nfeEmissionDurationsMs: [],
  orderCloseDurationsMs: [],
  uptimeSince: Date.now(),
};

export function incTotalRequests(): void {
  metrics.totalRequests += 1;
}

export function incTotalErrors(): void {
  metrics.totalErrors += 1;
}

export function incNfeFailures(): void {
  metrics.nfeFailures += 1;
}

export function incJobFailures(): void {
  metrics.jobFailures += 1;
}

export function incDeadLetterCount(): void {
  metrics.deadLetterCount += 1;
}

/** Record the wall-clock duration (ms) of a full NF-e SEFAZ emission cycle. */
export function recordNfeEmissionDuration(ms: number): void {
  metrics.nfeEmissionDurationsMs.push(ms);
  if (metrics.nfeEmissionDurationsMs.length > DURATION_SAMPLES) {
    metrics.nfeEmissionDurationsMs.shift();
  }
}

/** Record the wall-clock duration (ms) from order creation to delivery close. */
export function recordOrderCloseDuration(ms: number): void {
  metrics.orderCloseDurationsMs.push(ms);
  if (metrics.orderCloseDurationsMs.length > DURATION_SAMPLES) {
    metrics.orderCloseDurationsMs.shift();
  }
}

export function incErrorsByRoute(route: string): void {
  const key = normalizeRoute(route);
  metrics.errorsByRoute[key] = (metrics.errorsByRoute[key] ?? 0) + 1;
}

export function incRequestsByTenant(tenantId: string | number): void {
  const key = String(tenantId);
  metrics.requestsByTenant[key] = (metrics.requestsByTenant[key] ?? 0) + 1;
}

export function recordLatency(route: string, ms: number): void {
  const key = normalizeRoute(route);
  if (!metrics.latencySamplesByRoute[key]) {
    metrics.latencySamplesByRoute[key] = [];
  }
  const samples = metrics.latencySamplesByRoute[key];
  samples.push(ms);
  if (samples.length > LATENCY_SAMPLES) {
    samples.shift();
  }
}

function avgOf(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function p95Of(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[idx] ?? sorted[sorted.length - 1];
}

/** Return a snapshot with derived averages and percentiles. */
export function getMetrics(): Metrics & {
  avgLatencyByRoute: Record<string, number>;
  nfeEmissionAvgMs: number | null;
  nfeEmissionP95Ms: number | null;
  orderCloseAvgMs: number | null;
  orderCloseP95Ms: number | null;
} {
  const avgLatencyByRoute: Record<string, number> = {};
  for (const [route, samples] of Object.entries(metrics.latencySamplesByRoute)) {
    if (samples.length === 0) continue;
    avgLatencyByRoute[route] =
      Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  }
  return {
    ...metrics,
    avgLatencyByRoute,
    nfeEmissionAvgMs: avgOf(metrics.nfeEmissionDurationsMs),
    nfeEmissionP95Ms: p95Of(metrics.nfeEmissionDurationsMs),
    orderCloseAvgMs: avgOf(metrics.orderCloseDurationsMs),
    orderCloseP95Ms: p95Of(metrics.orderCloseDurationsMs),
  };
}

/** Reset all metrics (MASTER only). */
export function resetMetrics(): void {
  metrics.totalRequests = 0;
  metrics.totalErrors = 0;
  metrics.nfeFailures = 0;
  metrics.jobFailures = 0;
  metrics.deadLetterCount = 0;
  metrics.errorsByRoute = {};
  metrics.requestsByTenant = {};
  metrics.latencySamplesByRoute = {};
  metrics.nfeEmissionDurationsMs = [];
  metrics.orderCloseDurationsMs = [];
  metrics.uptimeSince = Date.now();
}

/**
 * Collapse dynamic segments so "/api/orders/123" → "/api/orders/:id".
 * Keeps the metrics map bounded regardless of ID cardinality.
 */
function normalizeRoute(path: string): string {
  return path
    .replace(/\/\d+/g, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
    .slice(0, 80);
}
