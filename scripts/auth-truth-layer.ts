import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

type CliEntity = {
  id: number;
  type: "user" | "company";
  decision: "OK" | "LOCKED" | "HIGH_RISK" | "SUSPICIOUS_IP_SPREAD" | "RATE_SPIKE";
  metrics: Record<string, number>;
};

type CliReport = {
  summary?: Record<string, unknown>;
  perEntity: CliEntity[];
};

type SystemDecision = {
  decision: "SUCCESS" | "LOCKED" | "RISK_LOCK" | "RATE_LIMITED";
  riskScore: number;
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? undefined : { rejectUnauthorized: false },
});

const CLI_REPORT_PATH = process.env.CLI_REPORT_PATH ?? "cliReport.json";

function compareDecisions(system: SystemDecision, cli: CliEntity["decision"]) {
  if (system.decision === cli) return "CONSISTENT";
  if (system.decision === "SUCCESS" && cli !== "OK") return "FALSE_POSITIVE";
  if (system.decision !== "SUCCESS" && cli === "OK") return "FALSE_NEGATIVE";
  return "DRIFT";
}

async function loadCliReport(): Promise<CliReport> {
  const raw = await readFile(CLI_REPORT_PATH, "utf8");
  return JSON.parse(raw) as CliReport;
}

async function loadSystemDecisions(): Promise<Map<string, SystemDecision>> {
  const [users, companies] = await Promise.all([
    pool.query(`SELECT id, "isLocked" AS locked, "active" AS active FROM users`),
    pool.query(`SELECT id, "isLocked" AS locked, "active" AS active FROM companies`),
  ]);

  const map = new Map<string, SystemDecision>();
  for (const row of users.rows as Array<{ id: number; locked: boolean; active: boolean }>) {
    map.set(`user:${row.id}`, {
      decision: !row.active ? "LOCKED" : row.locked ? "LOCKED" : "SUCCESS",
      riskScore: row.locked ? 100 : row.active ? 0 : 100,
    });
  }
  for (const row of companies.rows as Array<{ id: number; locked: boolean; active: boolean }>) {
    map.set(`company:${row.id}`, {
      decision: !row.active ? "LOCKED" : row.locked ? "LOCKED" : "SUCCESS",
      riskScore: row.locked ? 100 : row.active ? 0 : 100,
    });
  }
  return map;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const cli = await loadCliReport();
  const systemDecisions = await loadSystemDecisions();

  const rows = cli.perEntity.map((entity) => {
    const system = systemDecisions.get(`${entity.type}:${entity.id}`) ?? {
      decision: "LOCKED",
      riskScore: 100,
    };
    const divergenceType = compareDecisions(system, entity.decision);
    return {
      entityId: entity.id,
      type: entity.type,
      systemDecision: system.decision,
      cliDecision: entity.decision,
      divergenceType,
      riskScoreSystem: system.riskScore,
      riskScoreCLI: entity.decision === "OK" ? 0 : 100,
    };
  });

  const total = rows.length || 1;
  const consistent = rows.filter((r) => r.divergenceType === "CONSISTENT").length;
  const falsePositives = rows.filter((r) => r.divergenceType === "FALSE_POSITIVE").length;
  const falseNegatives = rows.filter((r) => r.divergenceType === "FALSE_NEGATIVE").length;
  const drift = rows.filter((r) => r.divergenceType === "DRIFT").length;
  const trustScore = Math.max(
    0,
    100 - falseNegatives * 2.0 - falsePositives * 1.5 - drift * 0.5,
  );

  const report = {
    summary: {
      totalEntitiesAnalyzed: rows.length,
      consistencyPercent: Number(((consistent / total) * 100).toFixed(1)),
      falsePositivePercent: Number(((falsePositives / total) * 100).toFixed(1)),
      falseNegativePercent: Number(((falseNegatives / total) * 100).toFixed(1)),
      driftPercent: Number(((drift / total) * 100).toFixed(1)),
      trustScore: Number(trustScore.toFixed(1)),
    },
    heatmap: rows,
    topDivergences: rows
      .filter((r) => r.divergenceType !== "CONSISTENT")
      .slice(0, 20),
  };

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