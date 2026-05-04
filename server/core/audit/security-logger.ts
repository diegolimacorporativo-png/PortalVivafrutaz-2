import { storage } from "../../services/storage";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TenantScope = "SINGLE" | "CROSS";

export type AccessIntent =
  | "BI_ANALYTICS"
  | "FINANCIAL_REPORT"
  | "LOGISTICS_OPTIMIZATION"
  | "AUDIT_SYSTEM"
  | "USER_MANAGEMENT"
  | "EXPORT_DATA"
  | "AI_DATA_ACCESS"
  | "UNKNOWN";

export type RoleRiskLevel = "HIGH" | "MEDIUM" | "LOW";

export interface SecurityEventPayload {
  userId?: number;
  companyId?: number | null;
  role?: string;
  action: string;
  resource: string;
  tenantScope: TenantScope;
  intent: AccessIntent;
  allowed: boolean;
  metadata?: Record<string, unknown>;
}

// ─── Role risk classification ─────────────────────────────────────────────────

export function classifyRoleRisk(role: string): RoleRiskLevel {
  if (["MASTER", "ADMIN"].includes(role)) return "HIGH";
  if (["DIRECTOR", "OPERATIONS_MANAGER", "GESTOR_CONTRATOS", "DEVELOPER"].includes(role))
    return "MEDIUM";
  return "LOW";
}

// ─── Anomaly detection — in-memory sliding-window counters ───────────────────
// Counters reset automatically after WINDOW_MS (1 hour per key).

interface WindowEntry {
  count: number;
  windowStart: number;
}

const anomalyCounters = new Map<string, WindowEntry>();
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function incrementAndCheck(userId: number, key: string, threshold: number): boolean {
  const now = Date.now();
  const mapKey = `${userId}:${key}`;
  const entry = anomalyCounters.get(mapKey);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    anomalyCounters.set(mapKey, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > threshold;
}

// ─── Core log function ────────────────────────────────────────────────────────

/**
 * logSecurityEvent — fire-and-forget security audit record.
 *
 * Writes to the existing systemLogs table with action prefix "SEC:<action>".
 * Description field carries a structured JSON payload for later filtering.
 *
 * NEVER throws — errors are swallowed so instrumentation never breaks a route.
 */
export function logSecurityEvent(payload: SecurityEventPayload): void {
  const riskLevel: string = payload.role ? classifyRoleRisk(payload.role) : "UNKNOWN";

  // Anomaly checks
  let anomalyDetected = false;
  if (payload.userId) {
    if (payload.tenantScope === "CROSS") {
      anomalyDetected =
        incrementAndCheck(payload.userId, "cross_read", 1000) || anomalyDetected;
    }
    if (payload.action === "DATA_EXPORT") {
      anomalyDetected =
        incrementAndCheck(payload.userId, "export", 10) || anomalyDetected;
    }
  }

  // Flag when a LOW/MEDIUM risk role crosses tenant boundary unexpectedly
  const crossTenantRisk = payload.tenantScope === "CROSS" && riskLevel !== "HIGH";

  const level = anomalyDetected ? "ALERT" : crossTenantRisk ? "WARN" : "INFO";

  const description = JSON.stringify({
    action: payload.action,
    resource: payload.resource,
    tenantScope: payload.tenantScope,
    intent: payload.intent,
    allowed: payload.allowed,
    riskLevel,
    anomalyDetected,
    crossTenantRisk,
    metadata: payload.metadata ?? {},
    ts: new Date().toISOString(),
  });

  // Fire-and-forget — never awaited, never rethrows
  storage
    .createLog({
      action: `SEC:${payload.action}`,
      description,
      userId: payload.userId,
      companyId: payload.companyId ?? undefined,
      userRole: payload.role,
      level,
    })
    .catch((err: Error) => {
      console.error("[SECURITY_LOGGER] Failed to persist event:", err?.message);
    });

  if (anomalyDetected) {
    console.warn(
      `[SECURITY_ANOMALY] userId=${payload.userId} action=${payload.action} threshold exceeded`,
    );
  }
}
