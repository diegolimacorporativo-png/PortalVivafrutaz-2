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
}

const registry = new Map<string, JobRecord>();

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
