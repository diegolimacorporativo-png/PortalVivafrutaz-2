import "dotenv/config";
import { readFile } from "node:fs/promises";

type ScorePack = {
  securityScore: number;
  consistencyScore: number;
  stabilityScore: number;
  architectureScore: number;
  observabilityScore: number;
};

type InputSummary = {
  summary?: {
    trustScore?: number;
    falsePositivePercent?: number;
    falseNegativePercent?: number;
    driftPercent?: number;
    consistencyPercent?: number;
    totalEntitiesAnalyzed?: number;
    chaosScore?: number;
    systemStabilityScore?: number;
    authConsistencyScore?: number;
    nfEConsistencyScore?: number;
    sessionStabilityScore?: number;
    architectureScore?: number;
    securityScore?: number;
    consistencyScore?: number;
    observabilityScore?: number;
  };
  alerts?: Array<{ type: string; severity: string; description?: string }>;
  recommendations?: Array<{ type: string; severity: string; description?: string }>;
  topEntitiesProblematic?: Array<{ divergenceType?: string; driftScore?: number }>;
  testResults?: Array<{ scenario?: string; passed?: boolean; failurePoints?: string[] }>;
  verdict?: string;
};

const CLI_PATH = process.env.CLI_PATH ?? "scripts/output/cli-auth-audit.json";
const TRUTH_PATH = process.env.TRUTH_PATH ?? "scripts/output/auth-truth-layer.json";
const DASHBOARD_PATH = process.env.DASHBOARD_PATH ?? "scripts/output/auth-drift-dashboard.json";
const ALERT_PATH = process.env.ALERT_PATH ?? "scripts/output/auth-drift-alert-engine.json";
const GOV_PATH = process.env.GOV_PATH ?? "scripts/output/auth-governance-engine.json";
const CHAOS_PATH = process.env.CHAOS_PATH ?? "scripts/output/auth-chaos-test-engine.json";

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function calculateProductionScore(scores: ScorePack) {
  return (
    scores.securityScore * 0.3 +
    scores.consistencyScore * 0.2 +
    scores.stabilityScore * 0.25 +
    scores.architectureScore * 0.15 +
    scores.observabilityScore * 0.1
  );
}

function clamp(score: number) {
  return Math.max(0, Math.min(100, score));
}

function finalVerdict(score: number) {
  if (score >= 90) return "PRODUCTION READY";
  if (score >= 75) return "READY WITH MONITORING";
  if (score >= 60) return "NOT READY";
  return "CRITICAL SYSTEM RISK";
}

async function main() {
  const [cli, truth, dashboard, alert, gov, chaos] = await Promise.all([
    loadJson<InputSummary>(CLI_PATH),
    loadJson<InputSummary>(TRUTH_PATH),
    loadJson<InputSummary>(DASHBOARD_PATH),
    loadJson<InputSummary>(ALERT_PATH),
    loadJson<InputSummary>(GOV_PATH),
    loadJson<InputSummary>(CHAOS_PATH),
  ]);

  const trustScore = dashboard.summary?.trustScore ?? truth.summary?.trustScore ?? cli.summary?.trustScore ?? 100;
  const falsePositivePercent = alert.summary?.falsePositiveRate ?? dashboard.summary?.falsePositivePercent ?? cli.summary?.falsePositivePercent ?? 0;
  const falseNegativePercent = alert.summary?.falseNegativeRate ?? dashboard.summary?.falseNegativePercent ?? cli.summary?.falseNegativePercent ?? 0;
  const driftPercent = dashboard.summary?.driftPercent ?? truth.summary?.driftPercent ?? cli.summary?.driftPercent ?? 0;
  const consistencyPercent = dashboard.summary?.consistencyPercent ?? truth.summary?.consistencyPercent ?? cli.summary?.consistencyPercent ?? 100;
  const chaosScore = chaos.summary?.chaosScore ?? 100;
  const chaosSystemStability = chaos.summary?.systemStabilityScore ?? 100;
  const chaosAuthConsistency = chaos.summary?.authConsistencyScore ?? 100;
  const chaosNfEConsistency = chaos.summary?.nfEConsistencyScore ?? 100;
  const chaosSessionStability = chaos.summary?.sessionStabilityScore ?? 100;

  const securityScore = clamp(
    100 - falseNegativePercent * 1.5 - Math.max(0, 70 - trustScore) * 0.5 - (alert.alerts?.some((a) => a.type === "SECURITY_RISK") ? 10 : 0),
  );
  const consistencyScore = clamp((consistencyPercent + (100 - driftPercent)) / 2 - Math.max(0, 70 - trustScore) * 0.2);
  const stabilityScore = clamp((chaosScore + chaosSystemStability + chaosSessionStability + chaosNfEConsistency) / 4);
  const architectureScore = clamp(
    gov.summary?.architectureScore ??
      100 - (gov.recommendations?.length ?? 0) * 6 - (dashboard.topEntitiesProblematic?.length ?? 0) * 0.5,
  );
  const observabilityScore = clamp(
    gov.summary?.consistencyScore ??
      100 - (alert.alerts?.length ?? 0) * 8 - (cli.summary?.totalEntitiesAnalyzed ? 0 : 15),
  );

  const productionScore = calculateProductionScore({
    securityScore,
    consistencyScore,
    stabilityScore,
    architectureScore,
    observabilityScore,
  });

  const blockers = [
    ...(falseNegativePercent > 10
      ? [
          {
            category: "SECURITY",
            issue: "False negatives above threshold",
            severity: "CRITICAL",
            impactedModule: "server/core/auth",
          },
        ]
      : []),
    ...(chaosScore < 75
      ? [
          {
            category: "STABILITY",
            issue: "Chaos score indicates fragility under load",
            severity: chaosScore < 60 ? "CRITICAL" : "HIGH",
            impactedModule: "server/core/security",
          },
        ]
      : []),
    ...(architectureScore < 70
      ? [
          {
            category: "ARCHITECTURE",
            issue: "Duplicated auth/session/rate-limit logic remains",
            severity: "MEDIUM",
            impactedModule: "server/middleware/auth.ts",
          },
        ]
      : []),
  ];

  const actions = [
    "Fix critical security gaps",
    "Align auth decision consistency",
    "Stabilize session and concurrency flows",
    "Reduce duplicated auth logic",
    "Improve observability coverage",
  ].sort((a, b) => {
    const impact = {
      "Fix critical security gaps": 5,
      "Align auth decision consistency": 4,
      "Stabilize session and concurrency flows": 3,
      "Reduce duplicated auth logic": 2,
      "Improve observability coverage": 1,
    };
    return impact[b as keyof typeof impact] - impact[a as keyof typeof impact];
  });

  const report = {
    summary: {
      productionScore: Number(productionScore.toFixed(1)),
      securityScore: Number(securityScore.toFixed(1)),
      consistencyScore: Number(consistencyScore.toFixed(1)),
      stabilityScore: Number(stabilityScore.toFixed(1)),
      architectureScore: Number(architectureScore.toFixed(1)),
      observabilityScore: Number(observabilityScore.toFixed(1)),
    },
    verdict: finalVerdict(productionScore),
    blockers,
    recommendedNextActions: actions,
    inputs: {
      trustScore,
      falsePositivePercent,
      falseNegativePercent,
      driftPercent,
      consistencyPercent,
      chaosScore,
      chaosAuthConsistency,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  console.log(report.verdict);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});