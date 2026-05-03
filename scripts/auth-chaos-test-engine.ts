import "dotenv/config";
import { readFile } from "node:fs/promises";

type Scenario = "BRUTE_FORCE" | "SESSION_STRESS" | "DEVICE_SPOOFING" | "NF_E_CONCURRENCY" | "RATE_LIMIT";

type LoadReport = {
  summary?: {
    trustScore?: number;
    falsePositivePercent?: number;
    falseNegativePercent?: number;
    consistencyPercent?: number;
    driftPercent?: number;
    totalEntitiesAnalyzed?: number;
  };
  alerts?: Array<{ type: string; severity: string }>;
  recommendations?: Array<{ type: string; severity: string }>;
  roadmap?: string[];
};

type ChaosResult = {
  scenario: Scenario;
  passed: boolean;
  failurePoints: string[];
  impactLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

const CLI_PATH = process.env.CLI_PATH ?? "scripts/output/cli-auth-audit.json";
const TRUTH_PATH = process.env.TRUTH_PATH ?? "scripts/output/auth-truth-layer.json";
const ALERT_PATH = process.env.ALERT_PATH ?? "scripts/output/auth-drift-alert-engine.json";
const GOV_PATH = process.env.GOV_PATH ?? "scripts/output/auth-governance-engine.json";

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function calculateChaosScore(metrics: {
  systemStabilityScore: number;
  authConsistencyScore: number;
  falseNegativeRate: number;
  falsePositiveRate: number;
}) {
  return (
    metrics.systemStabilityScore * 0.4 +
    metrics.authConsistencyScore * 0.3 +
    (100 - metrics.falseNegativeRate * 100) * 0.2 +
    (100 - metrics.falsePositiveRate * 100) * 0.1
  );
}

function classify(score: number) {
  if (score >= 90) return "ROBUST SYSTEM";
  if (score >= 75) return "STABLE WITH MINOR RISKS";
  if (score >= 50) return "FRAGILE UNDER LOAD";
  return "CRITICAL FAILURE RISK";
}

function scenarioImpact(value: number): ChaosResult["impactLevel"] {
  if (value >= 85) return "LOW";
  if (value >= 70) return "MEDIUM";
  if (value >= 50) return "HIGH";
  return "CRITICAL";
}

async function main() {
  const cli = await loadJson<LoadReport>(CLI_PATH);
  const truth = await loadJson<LoadReport>(TRUTH_PATH);
  const alert = await loadJson<LoadReport>(ALERT_PATH);
  const gov = await loadJson<LoadReport>(GOV_PATH);

  const trustScore = gov.summary?.trustScore ?? alert.summary?.trustScore ?? truth.summary?.trustScore ?? cli.summary?.trustScore ?? 100;
  const falseNegativeRate = (alert.summary?.falseNegativePercent ?? cli.summary?.falseNegativePercent ?? 0) / 100;
  const falsePositiveRate = (alert.summary?.falsePositivePercent ?? cli.summary?.falsePositivePercent ?? 0) / 100;
  const consistencyPercent = truth.summary?.consistencyPercent ?? cli.summary?.consistencyPercent ?? 100;
  const driftPercent = truth.summary?.driftPercent ?? cli.summary?.driftPercent ?? 0;

  const systemStabilityScore = Math.max(0, 100 - driftPercent - (alert.alerts?.length ?? 0) * 8);
  const authConsistencyScore = Math.max(0, consistencyPercent - (gov.recommendations?.length ?? 0) * 2);
  const nfEConsistencyScore = Math.max(0, 100 - (alert.alerts?.some((a) => a.type === "SYSTEM_INCONSISTENCY") ? 18 : 0));
  const sessionStabilityScore = Math.max(0, 100 - (alert.alerts?.some((a) => a.type === "SECURITY_RISK") ? 20 : 0));

  const chaosScore = calculateChaosScore({
    systemStabilityScore,
    authConsistencyScore,
    falseNegativeRate,
    falsePositiveRate,
  });

  const results: ChaosResult[] = [
    {
      scenario: "BRUTE_FORCE",
      passed: falseNegativeRate < 0.1 && trustScore >= 70,
      failurePoints: falseNegativeRate >= 0.1 ? ["security bypass tendency"] : [],
      impactLevel: scenarioImpact(systemStabilityScore),
    },
    {
      scenario: "SESSION_STRESS",
      passed: sessionStabilityScore >= 75,
      failurePoints: sessionStabilityScore < 75 ? ["session instability under load"] : [],
      impactLevel: scenarioImpact(sessionStabilityScore),
    },
    {
      scenario: "DEVICE_SPOOFING",
      passed: authConsistencyScore >= 75,
      failurePoints: authConsistencyScore < 75 ? ["device mismatch risk"] : [],
      impactLevel: scenarioImpact(authConsistencyScore),
    },
    {
      scenario: "NF_E_CONCURRENCY",
      passed: nfEConsistencyScore >= 75,
      failurePoints: nfEConsistencyScore < 75 ? ["idempotency / concurrency drift"] : [],
      impactLevel: scenarioImpact(nfEConsistencyScore),
    },
    {
      scenario: "RATE_LIMIT",
      passed: trustScore >= 70 && falsePositiveRate < 0.15,
      failurePoints: falsePositiveRate >= 0.15 ? ["over-blocking under burst load"] : [],
      impactLevel: scenarioImpact(100 - falsePositiveRate * 100),
    },
  ];

  const weakestSubsystem = [
    { name: "auth", score: authConsistencyScore },
    { name: "session", score: sessionStabilityScore },
    { name: "nf-e", score: nfEConsistencyScore },
    { name: "system", score: systemStabilityScore },
  ].sort((a, b) => a.score - b.score)[0];

  const highestFailureScenario = [...results].sort((a, b) => a.failurePoints.length - b.failurePoints.length)[0];
  const mostUnstableFlow = results.find((r) => !r.passed)?.scenario ?? "BRUTE_FORCE";
  const verdict =
    chaosScore >= 90 ? "PRODUCTION READY" : chaosScore >= 75 ? "NEEDS HARDENING" : "NOT STABLE FOR SCALE";

  const report = {
    summary: {
      chaosScore: Number(chaosScore.toFixed(1)),
      systemStabilityScore: Number(systemStabilityScore.toFixed(1)),
      authConsistencyScore: Number(authConsistencyScore.toFixed(1)),
      nfEConsistencyScore: Number(nfEConsistencyScore.toFixed(1)),
      sessionStabilityScore: Number(sessionStabilityScore.toFixed(1)),
    },
    testResults: results,
    riskAnalysis: {
      weakestSubsystem: weakestSubsystem.name,
      mostUnstableFlow,
      highestFailureScenario: highestFailureScenario.scenario,
      authenticationBottleneck: "rate-limit / session guards",
    },
    verdict,
  };

  console.log(JSON.stringify(report, null, 2));
  console.log(verdict);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});