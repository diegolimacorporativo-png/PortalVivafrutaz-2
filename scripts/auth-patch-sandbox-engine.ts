import "dotenv/config";
import { readFile } from "node:fs/promises";

type SandboxInput = {
  summary?: Record<string, number>;
  patchCandidates?: Array<{
    type?: string;
    severity?: string;
    patchProposal?: { description?: string; affectedFiles?: string[] };
    simulationResult?: { expectedImprovementScore?: number };
  }>;
  recommendations?: Array<{ type?: string; severity?: string }>;
  testResults?: Array<{ scenario?: string; passed?: boolean }>;
  verdict?: string;
};

type PatchSimulation = {
  patchId: string;
  impact: {
    securityDelta: number;
    stabilityDelta: number;
    performanceDelta: number;
    consistencyDelta: number;
  };
  risk: {
    rollbackComplexity: "LOW" | "MEDIUM" | "HIGH";
    sideEffects: string[];
    confidenceScore: number;
  };
  recommendation: "APPROVE FOR IMPLEMENTATION" | "REJECT OR REWORK";
};

const HEALING_PATH = process.env.HEALING_PATH ?? "scripts/output/auth-auto-healing-engine.json";
const GOV_PATH = process.env.GOV_PATH ?? "scripts/output/auth-governance-engine.json";
const CHAOS_PATH = process.env.CHAOS_PATH ?? "scripts/output/auth-chaos-test-engine.json";
const GATE_PATH = process.env.GATE_PATH ?? "scripts/output/production-readiness-gate.json";

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function scoreFromSummary(summary: Record<string, number> = {}) {
  return {
    security: summary.securityScore ?? 100,
    stability: summary.stabilityScore ?? summary.systemStabilityScore ?? summary.chaosScore ?? 100,
    performance: summary.performanceScore ?? 100,
    consistency: summary.consistencyScore ?? summary.authConsistencyScore ?? 100,
    total: summary.productionScore ?? 100,
  };
}

function simulatePatch(index: number, patch: { type?: string; severity?: string; simulationResult?: { expectedImprovementScore?: number } }) {
  const severity = patch.severity ?? "LOW";
  const base = patch.simulationResult?.expectedImprovementScore ?? (severity === "CRITICAL" ? 30 : severity === "HIGH" ? 20 : severity === "MEDIUM" ? 12 : 6);
  const multiplier = 1 + index * 0.05;
  const improvement = Number((base * multiplier).toFixed(1));
  const rollbackComplexity: "LOW" | "MEDIUM" | "HIGH" =
    severity === "CRITICAL" ? "HIGH" : severity === "HIGH" ? "MEDIUM" : "LOW";
  const confidenceScore = Number((100 - base * 1.2 - index * 2).toFixed(1));

  return {
    patchId: `${patch.type ?? "PATCH"}-${index + 1}`,
    impact: {
      securityDelta: Number((improvement * (severity === "CRITICAL" || severity === "HIGH" ? 0.6 : 0.2)).toFixed(1)),
      stabilityDelta: Number((improvement * 0.25).toFixed(1)),
      performanceDelta: Number((improvement * 0.2).toFixed(1)),
      consistencyDelta: Number((improvement * 0.3).toFixed(1)),
    },
    risk: {
      rollbackComplexity,
      sideEffects: [],
      confidenceScore: Math.max(0, Math.min(100, confidenceScore)),
    },
    recommendation: improvement > 10 ? "APPROVE FOR IMPLEMENTATION" : "REJECT OR REWORK",
  } satisfies PatchSimulation;
}

async function main() {
  const healing = await loadJson<SandboxInput>(HEALING_PATH);
  const governance = await loadJson<SandboxInput>(GOV_PATH);
  const chaos = await loadJson<SandboxInput>(CHAOS_PATH);
  const gate = await loadJson<SandboxInput>(GATE_PATH);

  const baseline = scoreFromSummary({
    ...(gate.summary ?? {}),
    ...(governance.summary ?? {}),
    ...(chaos.summary ?? {}),
  });

  const patches = healing.patchCandidates ?? [];
  const simulations = patches.map((patch, index) => simulatePatch(index, patch));

  const afterScore = Number(
    Math.min(
      100,
      baseline.total +
        simulations.reduce((sum, item) => sum + item.impact.securityDelta + item.impact.stabilityDelta + item.impact.performanceDelta + item.impact.consistencyDelta, 0) /
          Math.max(1, simulations.length * 2),
    ).toFixed(1),
  );
  const beforeScore = Number(baseline.total.toFixed(1));
  const improvementDelta = Number((afterScore - beforeScore).toFixed(1));
  const regressionsDetected = simulations.filter((item) => item.recommendation === "REJECT OR REWORK").length;

  const finalVerdict =
    afterScore >= 85 && regressionsDetected === 0
      ? "SAFE TO APPLY"
      : afterScore >= 70
        ? "REQUIRES REVIEW"
        : "HIGH RISK - DO NOT APPLY";

  const report = {
    patchSimulationReport: simulations,
    globalComparison: {
      beforeScore,
      afterScore,
      improvementDelta,
      regressionsDetected,
    },
    finalSandboxVerdict: finalVerdict,
    baseline: {
      securityScore: Number(baseline.security.toFixed(1)),
      stabilityScore: Number(baseline.stability.toFixed(1)),
      performanceScore: Number(baseline.performance.toFixed(1)),
      consistencyScore: Number(baseline.consistency.toFixed(1)),
    },
  };

  console.log(JSON.stringify(report, null, 2));
  console.log(finalVerdict);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});