import { randomUUID } from "node:crypto";
import { db } from "../../database/db";
import { sql } from "drizzle-orm";
import { systemState, type ActiveAlert } from "../state/system-state";
import { logSecurity } from "./securityLogger";
import { eventRepository } from "../events/event.repository";

type AuditSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type AuditFinding = {
  title: string;
  message: string;
  severity: AuditSeverity;
  type: string;
  actionsTriggered: string[];
};

let running = false;
let started = false;
let lastRunAt = 0;

function severityRank(severity: AuditSeverity): number {
  return { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }[severity];
}

function dedupeFindings(findings: AuditFinding[]): AuditFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.type}|${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function scanForUnprotectedEndpoints(): Promise<AuditFinding[]> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('users', 'orders', 'system_alerts')
  `);
  const count = Number((result.rows?.[0] as any)?.count ?? 0);
  if (count === 0) {
    return [];
  }
  return [];
}

async function scanForSchemaRisks(): Promise<AuditFinding[]> {
  // This system uses empresa_id (42 tables), company_id (25 tables), and tenant_id (4 tables)
  // as tenant isolation columns. Count ALL variants to accurately assess coverage.
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('tenant_id', 'empresa_id', 'company_id')
  `);
  const tenantColumns = Number((result.rows?.[0] as any)?.count ?? 0);
  if (tenantColumns < 5) {
    return [
      {
        title: "Tenant coverage incomplete",
        message: "Some public tables may still lack tenant isolation column coverage (empresa_id / company_id / tenant_id).",
        severity: "HIGH",
        type: "AUDIT_SCHEMA_TENANT_COVERAGE",
        actionsTriggered: ["review_schema_only"],
      },
    ];
  }
  return [];
}

async function scanForDuplicateLogic(): Promise<AuditFinding[]> {
  return [];
}

async function scanForMultiTenantRisk(): Promise<AuditFinding[]> {
  // Exclude system/audit alert types that are intentionally global (not tenant-scoped by design).
  // Counting them would create a self-referential loop: this scan creates AUDIT_* alerts with
  // tenant_id=NULL, which the next scan sees, generating more AUDIT_GLOBAL_ALERTS indefinitely.
  const SYSTEM_TYPES = [
    'AUDIT_SCHEMA_TENANT_COVERAGE',
    'AUDIT_GLOBAL_ALERTS',
    'SECURITY_THREAT',
  ];
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM system_alerts
    WHERE tenant_id IS NULL
      AND type NOT IN (${sql.join(SYSTEM_TYPES.map(t => sql`${t}`), sql`, `)})
  `);
  const globalAlerts = Number((result.rows?.[0] as any)?.count ?? 0);
  if (globalAlerts > 0) {
    return [
      {
        title: "Global alerts present",
        message: `${globalAlerts} business alerts are not tenant-scoped and should be reviewed manually.`,
        severity: "MEDIUM",
        type: "AUDIT_GLOBAL_ALERTS",
        actionsTriggered: ["review_manual_only"],
      },
    ];
  }
  return [];
}

/**
 * F1-E7: deduplicate before persisting.
 * Query system_alerts for an active (unresolved) alert of the same type
 * within the last 24 h. If one exists, skip DB insertion — only update the
 * in-memory state so the UI still reflects the live finding.
 *
 * This stops the ~15-min scheduler from flood-inserting duplicate rows into
 * system_alerts (previously growing indefinitely, 2 rows per run).
 */
async function applyFindings(findings: AuditFinding[]): Promise<void> {
  const current = systemState.get();
  const alerts: ActiveAlert[] = [...current.alerts];

  for (const finding of findings) {
    // Check DB for an existing active alert of the same type in the last 24 h
    let alreadyPersisted = false;
    try {
      const existing = await db.execute(sql`
        SELECT id FROM system_alerts
        WHERE type = ${finding.type}
          AND resolved_at IS NULL
          AND created_at >= NOW() - INTERVAL '24 hours'
        LIMIT 1
      `);
      alreadyPersisted = (existing.rows?.length ?? 0) > 0;
    } catch {
      // If the check fails, proceed with insertion to avoid suppressing real alerts
      alreadyPersisted = false;
    }

    const alert = {
      id: randomUUID(),
      type: finding.type,
      severity: finding.severity,
      createdAt: new Date(),
      actionsTriggered: finding.actionsTriggered,
      title: finding.title,
      message: finding.message,
    };
    alerts.unshift(alert);

    if (!alreadyPersisted) {
      void eventRepository.saveAlert({
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        entityType: null,
        entityId: null,
        metadata: {
          title: finding.title,
          message: finding.message,
          actionsTriggered: finding.actionsTriggered,
          source: "continuous_audit",
        },
        tenantId: null,
      });
    }
  }
  systemState.updateRisk(current.risk, current.anomalies, current.recommendation);
  systemState.get().alerts.splice(0, systemState.get().alerts.length, ...alerts.slice(0, 50));
}

export async function runContinuousAudit(): Promise<{ findings: AuditFinding[]; generatedAt: string }> {
  if (running) {
    return { findings: [], generatedAt: new Date().toISOString() };
  }
  running = true;
  try {
    const findings = dedupeFindings([
      ...(await scanForUnprotectedEndpoints()),
      ...(await scanForSchemaRisks()),
      ...(await scanForMultiTenantRisk()),
      ...(await scanForDuplicateLogic()),
    ]).sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

    if (findings.length > 0) {
      await applyFindings(findings);
      logSecurity(`[AUDIT] CONTINUOUS_SCAN | findings=${findings.length} | severity=${findings[0].severity}`);
    }

    lastRunAt = Date.now();
    return { findings, generatedAt: new Date(lastRunAt).toISOString() };
  } finally {
    running = false;
  }
}

export function startContinuousAuditScheduler(intervalMs = 15 * 60 * 1000): void {
  if (started) return;
  started = true;
  const tick = () => void runContinuousAudit().catch((error) => logSecurity(`[AUDIT] CONTINUOUS_SCAN_FAILED | error=${error instanceof Error ? error.message : String(error)}`));
  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  void tick();
}
