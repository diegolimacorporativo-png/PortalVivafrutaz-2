import "dotenv/config";
import { readFile } from "node:fs/promises";

type Summary = {
  totalEntitiesAnalyzed?: number;
  trustScore?: number;
  falsePositivePercent?: number;
  falseNegativePercent?: number;
  driftPercent?: number;
  consistencyPercent?: number;
};

type DashboardRow = {
  entityId: number;
  type: "user" | "company";
  systemDecision: string;
  cliDecision: string;
  divergenceType: string;
  riskScoreSystem: number;
  riskScoreCLI: number;
  driftScore?: number;
};

type AlertEngine = {
  summary?: {
    trustScore?: number;
    driftLevel?: string;
    totalEntities?: number;
    falsePositiveRate?: number;
    falseNegativeRate?: number;
    averageDriftScore?: number;
  };
  alerts?: Array<{ type: string; severity: string; description: string; affectedEntitiesCount: number }>;
  topEntitiesProblematic?: DashboardRow[];
  recommendation?: string;
};

const CLI_PATH = process.env.CLI_PATH ?? "scripts/output/cli-auth-audit.json";
const TRUTH_PATH = process.env.TRUTH_PATH ?? "scripts/output/auth-truth-layer.json";
const DASHBOARD_PATH = process.env.DASHBOARD_PATH ?? "scripts/output/auth-drift-dashboard.json";
const ALERT_PATH = process.env.ALERT_PATH ?? "scripts/output/auth-drift-alert-engine.json";

function generateRecommendation(issue: { type: string }) {
  if (issue.type === "SECURITY_GAP") return "Fix auth logic inconsistency between CLI and runtime";
  if (issue.type === "CONSISTENCY_DRIFT") return "Align system decision engine with CLI audit baseline";
  if (issue.type === "ARCHITECTURE_DEBT") return "Consolidate duplicated auth/session/rate-limit logic";
  if (issue.type === "PERFORMANCE_RISK") return "Replace N+1 queries with batch operations";
  if (issue.type === "OBSERVABILITY_GAP") return "Increase logging consistency across auth pipeline";
  return "Review issue";
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function scoreFromSummary(summary: Summary) {
  const trust = summary.trustScore ?? 100;
  const falsePositive = summary.falsePositivePercent ?? 0;
  const falseNegative = summary.falseNegativePercent ?? 0;
  const drift = summary.driftPercent ?? 0;
  const consistency = summary.consistencyPercent ?? 100;
  return {
    securityScore: Number(Math.max(0, 100 - falseNegative * 2 - falsePositive).toFixed(1)),
    consistencyScore: Number(Math.max(0, consistency).toFixed(1)),
    architectureScore: Number(Math.max(0, 100 - drift - (100 - trust) * 0.5).toFixed(1)),
  };
}

async function main() {
  const cli = await loadJson<{ summary?: Summary }>(CLI_PATH);
  const truth = await loadJson<{ summary?: Summary }>(TRUTH_PATH);
  const dashboard = await loadJson<{ summary?: Summary; heatmap?: DashboardRow[] }>(DASHBOARD_PATH);
  const alert = await loadJson<AlertEngine>(ALERT_PATH).catch(() => ({} as AlertEngine));

  const summary = { ...cli.summary, ...truth.summary, ...dashboard.summary, ...(alert.summary ?? {}) };
  const scores = scoreFromSummary(summary);
  const topEntities = (dashboard.heatmap ?? alert.topEntitiesProblematic ?? []).slice(0, 20);

  const recommendations = [
    {
      type: "SECURITY_GAP",
      severity: (summary.falseNegativePercent ?? 0) > 10 ? "CRITICAL" : "HIGH",
      description: "False negatives indicate runtime auth bypass risk.",
      recommendation: generateRecommendation({ type: "SECURITY_GAP" }),
      affectedModules: ["server/core/auth", "server/core/security", "server/modules/auth"],
    },
    {
      type: "CONSISTENCY_DRIFT",
      severity: (summary.trustScore ?? 100) < 70 ? "HIGH" : "MEDIUM",
      description: "CLI audit and runtime decisions are diverging.",
      recommendation: generateRecommendation({ type: "CONSISTENCY_DRIFT" }),
      affectedModules: ["scripts/cli-auth-audit.ts", "scripts/auth-truth-layer.ts", "scripts/auth-drift-dashboard.ts"],
    },
    {
      type: "ARCHITECTURE_DEBT",
      severity: "MEDIUM",
      description: "Auth/session/rate-limit logic is duplicated across layers.",
      recommendation: generateRecommendation({ type: "ARCHITECTURE_DEBT" }),
      affectedModules: ["server/core/auth", "server/middleware/auth.ts", "server/core/http/requireAuth.ts"],
    },
    {
      type: "PERFORMANCE_RISK",
      severity: "MEDIUM",
      description: "Repeated read passes can become costly with larger datasets.",
      recommendation: generateRecommendation({ type: "PERFORMANCE_RISK" }),
      affectedModules: ["scripts/cli-auth-audit.ts", "scripts/auth-truth-layer.ts", "scripts/auth-drift-dashboard.ts"],
    },
    {
      type: "OBSERVABILITY_GAP",
      severity: "LOW",
      description: "Coverage of structured auth diagnostics remains partial.",
      recommendation: generateRecommendation({ type: "OBSERVABILITY_GAP" }),
      affectedModules: ["server/core/auth", "server/modules/auth", "scripts/output"],
    },
  ];

  const criticalIssues = recommendations.filter((r) => r.severity === "CRITICAL").length;
  const warningIssues = recommendations.length - criticalIssues;

  const report = {
    summary: {
      totalIssues: recommendations.length,
      criticalIssues,
      warningIssues,
      architectureScore: scores.architectureScore,
      securityScore: scores.securityScore,
      consistencyScore: scores.consistencyScore,
    },
    recommendations,
    roadmap: [
      "Fix critical security gaps",
      "Align auth decision consistency",
      "Remove duplicated logic",
      "Optimize performance hotspots",
      "Improve observability coverage",
    ],
    topEntities,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});