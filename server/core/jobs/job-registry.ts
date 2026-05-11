/**
 * FASE 3.1 — Job Registry (in-memory, zero external deps).
 *
 * Tracks execution state for every background cron/worker so the
 * observability panel can show: last run, last status, last error,
 * total runs, total errors, and whether a job is currently running.
 *
 * Anti-overlap helper:
 *   `isJobRunning(name)` → callers can skip a tick if the previous one
 *   hasn't finished yet, preventing concurrent execution on slow operations.
 *
 * Pattern for every job:
 *   if (isJobRunning('my-job')) { console.warn('skip'); return; }
 *   startJobRun('my-job');
 *   try { await work(); finishJobRun('my-job', true); }
 *   catch (err) { finishJobRun('my-job', false, err.message); incJobFailures(); }
 *
 * Never throws — observability must not interrupt the job path.
 */

export type JobStatus = "idle" | "running" | "ok" | "error";

export interface JobRecord {
  name: string;
  isRunning: boolean;
  lastStarted?: number;
  lastFinished?: number;
  lastDurationMs?: number;
  lastStatus: JobStatus;
  lastError?: string;
  totalRuns: number;
  totalErrors: number;
  slowRunCount: number;
  /** Captured from AsyncLocalStorage at startJobRun time (if available). */
  lastTenantId?: number;
  lastCorrelationId?: string;
}

/** T701 — Enriched shape returned by getSlowJobsReport(). */
export interface SlowJobReport {
  jobName: string;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  slowRuns: number;
  totalRuns: number;
  lastDurationMs: number | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  currentlyRunning: boolean;
  lastError: string | null;
  tenantId: number | null;
  correlationId: string | null;
}

const registry = new Map<string, JobRecord>();

/**
 * Rolling duration samples per job (separate map keeps JobRecord clean).
 * Capped at DURATION_SAMPLES entries to bound memory.
 */
const durationSamples = new Map<string, number[]>();
const DURATION_SAMPLES = 100;

/** Jobs running longer than this threshold are flagged as slow. */
const SLOW_JOB_THRESHOLD_MS = 60_000;

function ensure(name: string): JobRecord {
  if (!registry.has(name)) {
    registry.set(name, {
      name,
      isRunning: false,
      lastStatus: "idle",
      totalRuns: 0,
      totalErrors: 0,
      slowRunCount: 0,
    });
  }
  return registry.get(name)!;
}

/** Register a job name without starting a run. Call at module init. */
export function registerJob(name: string): void {
  try { ensure(name); } catch { /* never throw */ }
}

/** Mark a job as started. Returns false if already running (caller should skip). */
export function startJobRun(name: string): boolean {
  try {
    const rec = ensure(name);
    if (rec.isRunning) return false;
    rec.isRunning = true;
    rec.lastStarted = Date.now();
    rec.lastStatus = "running";
    return true;
  } catch {
    return true; // fail-open: let the job run
  }
}

/** Mark a job as finished. */
export function finishJobRun(name: string, ok: boolean, error?: string): void {
  try {
    const rec = ensure(name);
    const now = Date.now();
    const durationMs = rec.lastStarted ? now - rec.lastStarted : undefined;
    rec.isRunning = false;
    rec.lastFinished = now;
    rec.lastDurationMs = durationMs;
    rec.totalRuns += 1;
    // T701 — accumulate rolling duration samples for avg/p95 computation.
    if (durationMs !== undefined) {
      if (!durationSamples.has(name)) durationSamples.set(name, []);
      const samples = durationSamples.get(name)!;
      samples.push(durationMs);
      if (samples.length > DURATION_SAMPLES) samples.shift();
    }
    if (durationMs !== undefined && durationMs > SLOW_JOB_THRESHOLD_MS) {
      rec.slowRunCount += 1;
      console.warn(`[JOB_REGISTRY] Slow job detected: ${name} took ${Math.round(durationMs / 1000)}s (threshold ${SLOW_JOB_THRESHOLD_MS / 1000}s)`);
    }
    if (ok) {
      rec.lastStatus = "ok";
      rec.lastError = undefined;
    } else {
      rec.lastStatus = "error";
      rec.lastError = error?.slice(0, 500);
      rec.totalErrors += 1;
    }
  } catch { /* never throw */ }
}

/** Return all jobs that had at least one slow run, sorted by slowRunCount desc. */
export function getSlowJobs(): JobRecord[] {
  try {
    return [...registry.values()]
      .filter((r) => r.slowRunCount > 0)
      .sort((a, b) => b.slowRunCount - a.slowRunCount);
  } catch {
    return [];
  }
}

/**
 * T701 — Return all registered jobs with computed avg/p95 latency and the
 * full set of fields needed by the slow-jobs monitoring endpoint.
 * Sorted by slowRuns desc so the worst offenders surface first.
 * Never throws.
 */
export function getSlowJobsReport(): SlowJobReport[] {
  try {
    return [...registry.values()]
      .sort((a, b) => b.slowRunCount - a.slowRunCount)
      .map((rec): SlowJobReport => {
        const samples = durationSamples.get(rec.name) ?? [];
        return {
          jobName:        rec.name,
          avgDurationMs:  avgOf(samples),
          p95DurationMs:  p95Of(samples),
          slowRuns:       rec.slowRunCount,
          totalRuns:      rec.totalRuns,
          lastDurationMs: rec.lastDurationMs ?? null,
          lastStartedAt:  rec.lastStarted  ? new Date(rec.lastStarted).toISOString()  : null,
          lastFinishedAt: rec.lastFinished ? new Date(rec.lastFinished).toISOString() : null,
          currentlyRunning: rec.isRunning,
          lastError:      rec.lastError ?? null,
          tenantId:       rec.lastTenantId       ?? null,
          correlationId:  rec.lastCorrelationId  ?? null,
        };
      });
  } catch {
    return [];
  }
}

// ── private stats helpers ────────────────────────────────────────────────────

function avgOf(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function p95Of(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[idx] ?? sorted[sorted.length - 1] ?? null;
}

/** Returns true if the job is currently executing. */
export function isJobRunning(name: string): boolean {
  try {
    return registry.get(name)?.isRunning ?? false;
  } catch {
    return false;
  }
}

/**
 * Stale-lock recovery: if a job has been "running" for more than
 * `maxAgeMs` (default 30 min) it is assumed crashed without cleanup.
 * Reset its state so the next tick can proceed.
 */
export function recoverStaleJob(name: string, maxAgeMs = 30 * 60_000): boolean {
  try {
    const rec = registry.get(name);
    if (!rec || !rec.isRunning || !rec.lastStarted) return false;
    if (Date.now() - rec.lastStarted < maxAgeMs) return false;
    rec.isRunning = false;
    rec.lastStatus = "error";
    rec.lastError = `Stale lock recovered after ${Math.round(maxAgeMs / 60000)}min`;
    rec.totalErrors += 1;
    console.warn(`[JOB_REGISTRY] Stale lock recovered: ${name}`);
    return true;
  } catch {
    return false;
  }
}

/** Return a snapshot of all registered jobs (newest-run first). */
export function getJobRegistry(): JobRecord[] {
  try {
    return [...registry.values()].sort((a, b) => {
      const aT = a.lastStarted ?? 0;
      const bT = b.lastStarted ?? 0;
      return bT - aT;
    });
  } catch {
    return [];
  }
}
