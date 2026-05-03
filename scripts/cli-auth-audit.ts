import "dotenv/config";
import { Pool } from "pg";

type EntityRow = {
  id: number;
  email?: string | null;
  name?: string | null;
  isLocked?: boolean | null;
  isActive?: boolean | null;
  deviceId?: string | null;
  tokenVersion?: number | null;
};

type AttemptRow = {
  user_id?: number | null;
  company_id?: number | null;
  ip?: string | null;
  device_id?: string | null;
  success?: boolean | null;
  created_at?: string | Date | null;
};

type SessionRow = {
  user_id?: number | null;
  company_id?: number | null;
  device_id?: string | null;
  token_version?: number | null;
  created_at?: string | Date | null;
};

type Decision = "OK" | "LOCKED" | "HIGH_RISK" | "SUSPICIOUS_IP_SPREAD" | "RATE_SPIKE";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? undefined : { rejectUnauthorized: false },
});

function toId(row: AttemptRow | SessionRow): number | null {
  return row.user_id ?? row.company_id ?? null;
}

function windowCount(rows: AttemptRow[], minutes: number): number {
  const cutoff = Date.now() - minutes * 60 * 1000;
  return rows.filter((row) => {
    const ts = row.created_at ? new Date(row.created_at).getTime() : 0;
    return ts >= cutoff;
  }).length;
}

function simulateAuthRisk(metrics: {
  isLocked: boolean;
  failureRate: number;
  ipCount: number;
  spikeDetected: boolean;
}): Decision {
  if (metrics.isLocked) return "LOCKED";
  if (metrics.failureRate > 0.8) return "HIGH_RISK";
  if (metrics.ipCount > 5) return "SUSPICIOUS_IP_SPREAD";
  if (metrics.spikeDetected) return "RATE_SPIKE";
  return "OK";
}

async function loadRows<T>(query: string): Promise<T[]> {
  const result = await pool.query(query);
  return result.rows as T[];
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const users = await loadRows<EntityRow>(
    `SELECT id, email, name, "isLocked" AS "isLocked", "active" AS "isActive", "deviceId" AS "deviceId", "tokenVersion" AS "tokenVersion" FROM users`,
  );
  const companies = await loadRows<EntityRow>(
    `SELECT id, email, name, "isLocked" AS "isLocked", "active" AS "isActive", "deviceId" AS "deviceId", "tokenVersion" AS "tokenVersion" FROM companies`,
  );
  const attempts = await loadRows<AttemptRow>(
    `SELECT user_id, company_id, ip, device_id, success, created_at FROM auth_attempts`,
  );
  const sessions = await loadRows<SessionRow>(
    `SELECT user_id, company_id, device_id, token_version, created_at FROM sessions`,
  );

  const entityRows = [
    ...users.map((entity) => ({ entity, type: "user" as const })),
    ...companies.map((entity) => ({ entity, type: "company" as const })),
  ];

  const perEntity = entityRows.map(({ entity, type }) => {
    const entityAttempts = attempts.filter((row) => toId(row) === entity.id && (type === "user" ? row.user_id : row.company_id) != null);
    const total = entityAttempts.length;
    const success = entityAttempts.filter((row) => row.success === true).length;
    const failure = entityAttempts.filter((row) => row.success === false).length;
    const failureRate = total > 0 ? failure / total : 0;
    const ipCount = new Set(entityAttempts.map((row) => row.ip).filter(Boolean)).size;
    const deviceSpread = new Set(entityAttempts.map((row) => row.device_id).filter(Boolean)).size;
    const recentAttempts = windowCount(entityAttempts, 15);
    const spikeDetected = windowCount(entityAttempts, 5) > Math.max(3, windowCount(entityAttempts, 15) / 3);
    const isLocked = Boolean(entity.isLocked);
    const decision = simulateAuthRisk({ isLocked, failureRate, ipCount, spikeDetected });
    const relatedSessions = sessions.filter((row) => toId(row) === entity.id);
    return {
      id: entity.id,
      type,
      decision,
      metrics: {
        failureRate: Number(failureRate.toFixed(2)),
        ipCount,
        recentAttempts,
        deviceSpread,
        successCount: success,
        failureCount: failure,
        sessionCount: relatedSessions.length,
      },
    };
  });

  const summary = {
    totalUsersAnalyzed: users.length,
    totalCompaniesAnalyzed: companies.length,
    highRiskPercent: perEntity.length ? Number(((perEntity.filter((r) => r.decision === "HIGH_RISK").length / perEntity.length) * 100).toFixed(1)) : 0,
    lockedPercent: perEntity.length ? Number(((perEntity.filter((r) => r.decision === "LOCKED").length / perEntity.length) * 100).toFixed(1)) : 0,
    suspiciousPercent: perEntity.length ? Number(((perEntity.filter((r) => r.decision === "SUSPICIOUS_IP_SPREAD" || r.decision === "RATE_SPIKE").length / perEntity.length) * 100).toFixed(1)) : 0,
  };

  const anomalies = {
    bruteForcePatterns: perEntity.filter((r) => r.metrics.failureRate > 0.8).map((r) => r.id),
    ipReuseCrossAccounts: Array.from(new Map(attempts.filter((a) => a.ip).flatMap((a) => [[a.ip as string, toId(a) ?? -1] as const])).entries()).length,
    loginSpikes: perEntity.filter((r) => r.decision === "RATE_SPIKE").map((r) => r.id),
    suspiciousClusters: perEntity.filter((r) => r.decision === "SUSPICIOUS_IP_SPREAD").map((r) => r.id),
  };

  const report = { summary, perEntity, anomalies };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });