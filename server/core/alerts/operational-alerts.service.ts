// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OPERATIONAL ALERTS ENGINE
// Central de alertas operacionais com deduplicação, cooldown e
// resolução automática. Zero dependências externas (in-memory).
//
// Logs:
//   [ALERT_EMIT]       — alerta novo ou reenviado após cooldown
//   [ALERT_SUPPRESSED] — alerta duplicado dentro do cooldown
//   [ALERT_RESOLVED]   — problema normalizado
//   [ALERT_PROBE]      — resultado do monitor periódico
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { randomUUID } from "node:crypto";

export type AlertSeverity = "INFO" | "WARN" | "ERROR" | "CRITICAL";

export interface ActiveAlert {
  key: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  correlationId: string;
  firstSeenAt: number;
  lastEmitAt: number;
  resolvedAt: number | null;
  occurrences: number;
  metadata: Record<string, unknown>;
}

// ─── Cooldown per severity ─────────────────────────────────────
const COOLDOWN_MS: Record<AlertSeverity, number> = {
  CRITICAL: 5 * 60_000,   // repeat every 5 min
  ERROR:    15 * 60_000,  // repeat every 15 min
  WARN:     15 * 60_000,  // repeat every 15 min
  INFO:     60 * 60_000,  // max once per hour
};

// ─── In-memory store ───────────────────────────────────────────
const _alerts = new Map<string, ActiveAlert>();
const MAX_RESOLVED_RETENTION_MS = 2 * 60 * 60_000; // keep resolved 2h for audit
const MAX_ALERTS_MAP_SIZE = 500; // cap to prevent unbounded memory growth

// ─── Emit ──────────────────────────────────────────────────────
export function emitAlert(
  key: string,
  severity: AlertSeverity,
  title: string,
  message: string,
  metadata: Record<string, unknown> = {},
): void {
  const now = Date.now();
  const existing = _alerts.get(key);

  if (existing && existing.resolvedAt === null) {
    const elapsed = now - existing.lastEmitAt;
    const cooldown = COOLDOWN_MS[severity];
    if (elapsed < cooldown) {
      console.debug("[ALERT_SUPPRESSED]", {
        key, severity, title,
        cooldownRemainingMs: cooldown - elapsed,
        occurrences: existing.occurrences,
        ts: new Date().toISOString(),
      });
      existing.occurrences += 1;
      return;
    }
    existing.occurrences += 1;
    existing.lastEmitAt = now;
    existing.severity = severity;
    existing.message = message;
    existing.metadata = { ...metadata };
    console.warn("[ALERT_EMIT]", {
      key, severity, title, message,
      correlationId: existing.correlationId,
      occurrences: existing.occurrences,
      activeForMs: now - existing.firstSeenAt,
      ...metadata,
      ts: new Date().toISOString(),
    });
    return;
  }

  const correlationId = randomUUID();
  const alert: ActiveAlert = {
    key, severity, title, message, correlationId,
    firstSeenAt: now, lastEmitAt: now,
    resolvedAt: null, occurrences: 1,
    metadata: { ...metadata },
  };
  _alerts.set(key, alert);

  const logFn = severity === "CRITICAL" || severity === "ERROR"
    ? console.error
    : severity === "WARN"
    ? console.warn
    : console.info;

  logFn("[ALERT_EMIT]", {
    key, severity, title, message, correlationId,
    occurrences: 1,
    ...metadata,
    ts: new Date().toISOString(),
  });
}

// ─── Resolve ───────────────────────────────────────────────────
export function resolveAlert(key: string, reason = "normalizado"): void {
  const alert = _alerts.get(key);
  if (!alert || alert.resolvedAt !== null) return;
  alert.resolvedAt = Date.now();
  console.info("[ALERT_RESOLVED]", {
    key,
    severity: alert.severity,
    title: alert.title,
    reason,
    correlationId: alert.correlationId,
    activeForMs: alert.resolvedAt - alert.firstSeenAt,
    occurrences: alert.occurrences,
    ts: new Date().toISOString(),
  });
}

// ─── Getters ───────────────────────────────────────────────────
export function getActiveAlerts(): ActiveAlert[] {
  pruneResolved();
  return [..._alerts.values()].filter(a => a.resolvedAt === null);
}

export function getAllAlerts(): ActiveAlert[] {
  pruneResolved();
  return [..._alerts.values()];
}

function pruneResolved() {
  const cutoff = Date.now() - MAX_RESOLVED_RETENTION_MS;
  for (const [key, alert] of _alerts.entries()) {
    if (alert.resolvedAt !== null && alert.resolvedAt < cutoff) {
      _alerts.delete(key);
    }
  }
}

// ─── Periodic Operational Probe ────────────────────────────────
// Checa DB, memória, fila, circuit breaker, workers, backup.
// Emite/resolve alertas automaticamente. Intervalo padrão: 60s.
// ──────────────────────────────────────────────────────────────

let _monitorStarted = false;
let _monitorInterval: ReturnType<typeof setInterval> | null = null;

export function startOperationalMonitor(intervalMs = 60_000): void {
  if (_monitorStarted) return;
  _monitorStarted = true;

  const run = async () => {
    try {
      await probeDatabase();
      await probeQueue();
      probeMemory();
      await probeCircuitBreaker();
      await probeWorkers();
      await probeBackup();

      // Cap Map size to prevent unbounded memory growth from unique alert keys
      if (_alerts.size > MAX_ALERTS_MAP_SIZE) {
        pruneResolved();
        if (_alerts.size > MAX_ALERTS_MAP_SIZE) {
          const toDelete = [..._alerts.keys()].slice(0, _alerts.size - MAX_ALERTS_MAP_SIZE);
          toDelete.forEach(k => _alerts.delete(k));
          console.warn("[ALERT_MAP_CAPPED]", { removed: toDelete.length, remaining: _alerts.size, ts: new Date().toISOString() });
        }
      }

      console.debug("[ALERT_PROBE]", {
        active: getActiveAlerts().length,
        total: getAllAlerts().length,
        ts: new Date().toISOString(),
      });
    } catch (e: any) {
      console.warn("[ALERT_PROBE_ERROR]", e?.message);
    }
  };

  _monitorInterval = setInterval(run, intervalMs);
  if (typeof _monitorInterval.unref === "function") _monitorInterval.unref();
  run().catch(() => {});
  console.info("[OPERATIONAL_MONITOR_START]", { intervalMs, ts: new Date().toISOString() });
}

export function stopOperationalMonitor(): void {
  if (_monitorInterval) {
    clearInterval(_monitorInterval);
    _monitorInterval = null;
    _monitorStarted = false;
    console.info("[OPERATIONAL_MONITOR_STOP]", { ts: new Date().toISOString() });
  }
}

// ─── Probes ───────────────────────────────────────────────────

async function probeDatabase() {
  try {
    const { pool } = await import("../../database/db");
    const { performance } = await import("perf_hooks");
    const t0 = performance.now();
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("DB_TIMEOUT")), 5000)),
    ]);
    const latencyMs = performance.now() - t0;

    if (latencyMs > 1000) {
      emitAlert(
        "postgres.latency.high",
        latencyMs > 3000 ? "CRITICAL" : "WARN",
        "Latência PostgreSQL alta",
        `Supabase respondeu em ${latencyMs.toFixed(0)}ms (threshold: 1000ms)`,
        { latencyMs: Math.round(latencyMs) },
      );
    } else {
      resolveAlert("postgres.latency.high", `latência normalizada em ${latencyMs.toFixed(0)}ms`);
    }
    resolveAlert("postgres.unavailable", "banco acessível");
  } catch (e: any) {
    emitAlert(
      "postgres.unavailable",
      "CRITICAL",
      "PostgreSQL indisponível",
      `Supabase não respondeu: ${e?.message ?? "timeout"}`,
      { error: e?.message },
    );
  }
}

async function probeQueue() {
  try {
    const { db } = await import("../../database/db");
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')     AS pending,
        COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter
      FROM outbox_events
    `);
    const row = (result as any).rows?.[0] ?? {};
    const pending = parseInt(row.pending ?? "0", 10);
    const deadLetter = parseInt(row.dead_letter ?? "0", 10);

    if (pending > 100) {
      emitAlert(
        "queue.backlog.high",
        pending > 500 ? "ERROR" : "WARN",
        "Fila Outbox com backlog alto",
        `${pending} eventos pendentes na outbox`,
        { pending, deadLetter },
      );
    } else {
      resolveAlert("queue.backlog.high", `fila normalizada: ${pending} pendentes`);
    }

    if (deadLetter > 10) {
      emitAlert(
        "queue.dead-letter.high",
        "ERROR",
        "Dead-letter acima do threshold",
        `${deadLetter} eventos em dead-letter na outbox`,
        { deadLetter, pending },
      );
    } else {
      resolveAlert("queue.dead-letter.high", `dead-letter OK: ${deadLetter}`);
    }
  } catch { /* não bloquear probe por falta de tabela */ }
}

function probeMemory() {
  const m = process.memoryUsage();
  const rssMB = m.rss / 1024 / 1024;
  const heapPct = m.heapUsed / m.heapTotal;

  if (rssMB > 1024) {
    emitAlert(
      "heap.rss.critical",
      "CRITICAL",
      "Memória RSS crítica",
      `RSS em ${rssMB.toFixed(0)}MB (threshold: 1024MB)`,
      { rssMB: Math.round(rssMB), heapPct: (heapPct * 100).toFixed(1) + "%" },
    );
  } else if (rssMB > 768) {
    emitAlert(
      "heap.rss.critical",
      "WARN",
      "Memória RSS elevada",
      `RSS em ${rssMB.toFixed(0)}MB (threshold warn: 768MB)`,
      { rssMB: Math.round(rssMB), heapPct: (heapPct * 100).toFixed(1) + "%" },
    );
  } else {
    resolveAlert("heap.rss.critical", `RSS normalizada: ${rssMB.toFixed(0)}MB`);
  }
}

async function probeCircuitBreaker() {
  try {
    const { getCircuitState } = await import("../../services/nfe/sefazCircuitBreaker");
    const state = getCircuitState();
    if (state.state !== "closed") {
      emitAlert(
        "circuit.breaker.open",
        state.state === "open" ? "CRITICAL" : "WARN",
        `Circuit Breaker SEFAZ ${state.state.toUpperCase()}`,
        `Circuit breaker em estado '${state.state}' — ${state.failures} falhas registradas`,
        {
          state: state.state,
          failures: state.failures,
          totalOpenings: state.totalOpenings,
          openedAt: state.openedAt ? new Date(state.openedAt).toISOString() : null,
        },
      );
    } else {
      resolveAlert("circuit.breaker.open", "circuit breaker fechado");
    }
  } catch { /* circuit breaker pode não existir */ }
}

async function probeWorkers() {
  try {
    const { getJobRegistry } = await import("../../core/jobs/job-registry");
    const jobs = getJobRegistry();
    for (const job of jobs) {
      const alertKey = `worker.job.failed.${job.name}`;
      if (job.totalErrors > 0 && job.lastError) {
        const recentFail = job.lastFinished != null
          && (Date.now() - job.lastFinished) < 30 * 60_000;
        if (recentFail) {
          emitAlert(
            alertKey,
            "ERROR",
            `Worker falhou: ${job.name}`,
            `${job.lastError.slice(0, 200)}`,
            { jobName: job.name, totalErrors: job.totalErrors, lastError: job.lastError?.slice(0, 200) },
          );
          continue;
        }
      }
      resolveAlert(alertKey, `job ${job.name} sem erros recentes`);
    }
  } catch { /* não bloquear probe */ }
}

async function probeBackup() {
  try {
    const { listBackupHistory } = await import("../../backup-storage.service");
    const rows = await listBackupHistory(10);
    if (rows.length === 0) return;

    const last = rows[0];
    const hoursSince = (Date.now() - new Date(last.createdAt).getTime()) / 3_600_000;

    if (hoursSince > 26) {
      emitAlert(
        "backup.stale",
        hoursSince > 48 ? "ERROR" : "WARN",
        "Backup sem execução recente",
        `Último backup há ${hoursSince.toFixed(1)}h (threshold: 26h)`,
        { lastBackup: last.filename, hoursSince: Math.round(hoursSince) },
      );
    } else {
      resolveAlert("backup.stale", `backup recente: ${last.filename}`);
    }

    const recentFailed = rows.slice(0, 3).filter(r =>
      r.uploadStatus === "failed" || r.verifyStatus === "failed"
    ).length;

    if (recentFailed >= 3) {
      emitAlert(
        "backup.consecutive.failures",
        "ERROR",
        "3 falhas consecutivas de upload do backup",
        `${recentFailed} dos últimos 3 backups falharam no upload/verify para Supabase Storage`,
        { recentFailed, lastBackup: last.filename },
      );
    } else {
      resolveAlert("backup.consecutive.failures", "uploads de backup normalizados");
    }
  } catch { /* backup_history pode não ter dados ainda */ }
}

// ─── Helpers para integração externa ─────────────────────────

/** Chamado pelo UNCAUGHT_EXCEPTION handler em server/index.ts */
export function alertUncaughtException(message: string): void {
  emitAlert("process.uncaught.exception", "CRITICAL", "Exceção não capturada", message, { message });
}

/** Chamado pelo UNHANDLED_REJECTION handler em server/index.ts */
export function alertUnhandledRejection(message: string): void {
  emitAlert("process.unhandled.rejection", "ERROR", "Promise rejection não tratada", message, { message });
}

/** Chamado pelo event loop lag em system-status */
export function alertEventLoopLag(lagMs: number): void {
  if (lagMs > 100) {
    emitAlert(
      "event.loop.lag",
      lagMs > 500 ? "ERROR" : "WARN",
      "Event loop com lag alto",
      `Node.js event loop atrasado em ${lagMs}ms (threshold: 100ms)`,
      { lagMs },
    );
  } else {
    resolveAlert("event.loop.lag", `event loop normalizado: ${lagMs}ms`);
  }
}

/** Chamado pelo fiscal runtime monitor */
export function alertFiscalProduction(source: string): void {
  emitAlert(
    "fiscal.production.attempt",
    "CRITICAL",
    "Tentativa de produção fiscal detectada",
    `Tentativa de ativar modo produção detectada em '${source}'`,
    { source },
  );
}

/** Chamado quando readiness falha */
export function alertReadinessFail(checks: Record<string, boolean>): void {
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  if (failed.length > 0) {
    emitAlert(
      "readiness.fail",
      "ERROR",
      "Health readiness falhou",
      `Checks com falha: ${failed.join(", ")}`,
      { failedChecks: failed },
    );
  } else {
    resolveAlert("readiness.fail", "todos os checks de readiness normalizados");
  }
}
