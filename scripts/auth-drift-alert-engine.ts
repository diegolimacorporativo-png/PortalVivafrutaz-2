import "dotenv/config";
import { readFile } from "node:fs/promises";

type DriftDashboardEntity = {
  entityId: number;
  type: "user" | "company";
  systemDecision: string;
  cliDecision: string;
  divergenceType: string;
  riskScoreSystem: number;
  riskScoreCLI: number;
  driftScore?: number;
};

type DriftDashboard = {
  summary?: {
    trustScore?: number;
    falsePositivePercent?: number;
    falseNegativePercent?: number;
    driftPercent?: number;
    consistencyPercent?: number;
    totalEntitiesAnalyzed?: number;
  };
  heatmap?: DriftDashboardEntity[];
  topDivergences?: DriftDashboardEntity[];
};

type AlertType = "CRITICAL_DRIFT" | "SECURITY_RISK" | "OVER_BLOCKING" | "SYSTEM_INCONSISTENCY";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const CLI_REPORT_PATH = process.env.CLI_REPORT_PATH ?? "scripts/output/cli-auth-audit.json";
const TRUTH_REPORT_PATH = process.env.TRUTH_REPORT_PATH ?? "scripts/output/auth-truth-layer.json";
const DASHBOARD_PATH = process.env.DASHBOARD_PATH ?? "scripts/output/auth-drift-dashboard.json";

function evaluateDrift(metrics: {
  trustScore: number;
  falseNegativeRate: number;
  falsePositiveRate: number;
  avgDriftScore: number;
}) {
  if (metrics.trustScore < 70) return "CRITICAL_DRIFT";
  if (metrics.falseNegativeRate > 0.1) return "SECURITY_RISK";
  if (metrics.falsePositiveRate > 0.15) return "OVER_BLOCKING";
  if (metrics.avgDriftScore > 20) return "SYSTEM_INCONSISTENCY";
  return "STABLE";
}

function severityFor(type: AlertType): Severity {
  switch (type) {
    case "CRITICAL_DRIFT":
      return "CRITICAL";
    case "SECURITY_RISK":
      return "HIGH";
    case "OVER_BLOCKING":
      return "HIGH";
    case "SYSTEM_INCONSISTENCY":
      return "MEDIUM";
  }
}

async function loadJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

async function main() {
  const cliReport = await loadJson<{ perEntity?: Array<{ id: number; type: string }> }>(CLI_REPORT_PATH);
  const truthReport = await loadJson<DriftDashboard>(TRUTH_REPORT_PATH);
  const dashboard = await loadJson<DriftDashboard>(DASHBOARD_PATH);

  const heatmap = dashboard.heatmap ?? truthReport.topDivergences ?? [];
  const summary = dashboard.summary ?? truthReport.summary ?? {};
  const totalEntities = summary.totalEntitiesAnalyzed ?? heatmap.length;
  const falsePositiveRate = summary.falsePositivePercent ?? 0;
  const falseNegativeRate = summary.falseNegativePercent ?? 0;
  const trustScore = summary.trustScore ?? 100;
  const avgDriftScore = heatmap.length
    ? heatmap.reduce((sum, row) => sum + (row.driftScore ?? Math.abs(row.riskScoreSystem - row.riskScoreCLI)), 0) / heatmap.length
    : 0;

  const driftLevel = evaluateDrift({
    trustScore,
    falseNegativeRate: falseNegativeRate / 100,
    falsePositiveRate: falsePositiveRate / 100,
    avgDriftScore,
  });

  const alerts: Array<{
    type: AlertType;
    severity: Severity;
    description: string;
    affectedEntitiesCount: number;
  }> = [];

  if (driftLevel === "CRITICAL_DRIFT") {
    alerts.push({
      type: "CRITICAL_DRIFT",
      severity: severityFor("CRITICAL_DRIFT"),
      description: "Trust score abaixo do limite operacional.",
      affectedEntitiesCount: heatmap.length,
    });
  }
  if (falseNegativeRate > 10) {
    alerts.push({
      type: "SECURITY_RISK",
      severity: severityFor("SECURITY_RISK"),
      description: "Taxa de false negatives acima do limite.",
      affectedEntitiesCount: heatmap.filter((row) => row.divergenceType === "FALSE_NEGATIVE").length,
    });
  }
  if (falsePositiveRate > 15) {
    alerts.push({
      type: "OVER_BLOCKING",
      severity: severityFor("OVER_BLOCKING"),
      description: "Taxa de false positives acima do limite.",
      affectedEntitiesCount: heatmap.filter((row) => row.divergenceType === "FALSE_POSITIVE").length,
    });
  }
  if (avgDriftScore > 20) {
    alerts.push({
      type: "SYSTEM_INCONSISTENCY",
      severity: severityFor("SYSTEM_INCONSISTENCY"),
      description: "Drift médio acima do limiar permitido.",
      affectedEntitiesCount: heatmap.length,
    });
  }

  const topEntitiesProblematic = [...heatmap]
    .sort((a, b) => (b.driftScore ?? Math.abs(b.riskScoreSystem - b.riskScoreCLI)) - (a.driftScore ?? Math.abs(a.riskScoreSystem - a.riskScoreCLI)))
    .slice(0, 20);

  const report = {
    summary: {
      trustScore,
      driftLevel,
      totalEntities,
      falsePositiveRate,
      falseNegativeRate,
      averageDriftScore: Number(avgDriftScore.toFixed(2)),
      cliEntities: cliReport.perEntity?.length ?? 0,
    },
    alerts,
    topEntitiesProblematic,
  };

  const recommendation =
    driftLevel === "CRITICAL_DRIFT" ? "RISK INTERVENTION REQUIRED" : driftLevel === "STABLE" ? "SAFE" : "MONITOR CLOSELY";

  console.log(JSON.stringify({ ...report, recommendation }, null, 2));
  console.log(recommendation);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});