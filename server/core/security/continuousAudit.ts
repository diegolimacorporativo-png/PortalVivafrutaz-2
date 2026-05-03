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
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'tenant_id'
  `);
  const tenantColumns = Number((result.rows?.[0] as any)?.count ?? 0);
  if (tenantColumns < 5) {
    return [
      {
        title: "Tenant coverage incomplete",
        message: "Some public tables may still lack tenant_id coverage for strict isolation checks.",
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
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM system_alerts
    WHERE tenant_id IS NULL
  `);
  const globalAlerts = Number((result.rows?.[0] as any)?.count ?? 0);
  if (globalAlerts > 0) {
    return [
      {
        title: "Global alerts present",
        message: `${globalAlerts} system alerts are not tenant-scoped and should be reviewed manually.`,
        severity: "MEDIUM",
        type: "AUDIT_GLOBAL_ALERTS",
        actionsTriggered: ["review_manual_only"],
      },
    ];
  }
  return [];
}

function applyFindings(findings: AuditFinding[]): void {
  const current = systemState.get();
  const alerts: ActiveAlert[] = [...current.alerts];
  for (const finding of findings) {
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
      applyFindings(findings);
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
