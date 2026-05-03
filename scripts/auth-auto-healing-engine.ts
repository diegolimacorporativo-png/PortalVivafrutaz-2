import "dotenv/config";
import { readFile } from "node:fs/promises";

type IssueType =
  | "SECURITY_HEALING"
  | "CONSISTENCY_HEALING"
  | "ARCHITECTURE_HEALING"
  | "PERFORMANCE_HEALING"
  | "OBSERVABILITY_HEALING";

type PatchCandidate = {
  type: IssueType;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
  modules: string[];
};

type ReadinessGate = {
  summary?: {
    productionScore?: number;
    securityScore?: number;
    consistencyScore?: number;
    stabilityScore?: number;
    architectureScore?: number;
    observabilityScore?: number;
  };
  verdict?: string;
  blockers?: Array<{ category?: string; issue?: string; severity?: string; impactedModule?: string }>;
  recommendedNextActions?: string[];
};

type HealingOutput = {
  problem: string;
  severity: string;
  patchProposal: {
    type: IssueType;
    description: string;
    affectedFiles: string[];
    estimatedImpact: "LOW" | "MEDIUM" | "HIGH";
    riskOfChange: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  };
  simulationResult: {
    expectedImprovementScore: number;
    sideEffects: string[];
    rollbackComplexity: "LOW" | "MEDIUM" | "HIGH";
  };
};

const CLI_PATH = process.env.CLI_PATH ?? "scripts/output/cli-auth-audit.json";
const TRUTH_PATH = process.env.TRUTH_PATH ?? "scripts/output/auth-truth-layer.json";
const ALERT_PATH = process.env.ALERT_PATH ?? "scripts/output/auth-drift-alert-engine.json";
const GOV_PATH = process.env.GOV_PATH ?? "scripts/output/auth-governance-engine.json";
const CHAOS_PATH = process.env.CHAOS_PATH ?? "scripts/output/auth-chaos-test-engine.json";
const GATE_PATH = process.env.GATE_PATH ?? "scripts/output/production-readiness-gate.json";

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function generateHealingPlan(issue: {
  type: IssueType;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
  modules: string[];
}): HealingOutput {
  const impact = issue.severity === "CRITICAL" ? "HIGH" : issue.severity === "HIGH" ? "HIGH" : issue.severity === "MEDIUM" ? "MEDIUM" : "LOW";
  const riskOfChange = issue.type === "SECURITY_HEALING" || issue.type === "CONSISTENCY_HEALING" ? "MEDIUM" : "LOW";
  const expectedImprovementScore = issue.severity === "CRITICAL" ? 35 : issue.severity === "HIGH" ? 25 : issue.severity === "MEDIUM" ? 15 : 8;

  return {
    problem: issue.description,
    severity: issue.severity,
    patchProposal: {
      type: issue.type,
      description: "Suggested structural fix",
      affectedFiles: issue.modules,
      estimatedImpact: impact,
      riskOfChange,
    },
    simulationResult: {
      expectedImprovementScore,
      sideEffects: [],
      rollbackComplexity: issue.severity === "CRITICAL" ? "HIGH" : issue.severity === "HIGH" ? "MEDIUM" : "LOW",
    },
  };
}

async function main() {
  const [cli, truth, alert, gov, chaos, gate] = await Promise.all([
    loadJson<{ summary?: { falseNegativePercent?: number; falsePositivePercent?: number } }>(CLI_PATH),
    loadJson<{ summary?: { trustScore?: number; consistencyPercent?: number } }>(TRUTH_PATH),
    loadJson<{ alerts?: Array<{ type?: string; severity?: string; description?: string }> }>(ALERT_PATH),
    loadJson<{ recommendations?: Array<{ type?: string; severity?: string; description?: string; affectedModules?: string[] }> }>(GOV_PATH),
    loadJson<{ summary?: { chaosScore?: number; systemStabilityScore?: number; authConsistencyScore?: number; nfEConsistencyScore?: number; sessionStabilityScore?: number } }>(CHAOS_PATH),
    loadJson<ReadinessGate>(GATE_PATH),
  ]);

  const securityIssues = alert.alerts?.filter((item) => item.type === "SECURITY_RISK" || item.type === "CRITICAL_DRIFT").length ?? 0;
  const architectureIssues = gov.recommendations?.filter((item) => item.type === "ARCHITECTURE_DEBT").length ?? 0;
  const performanceIssues = gov.recommendations?.filter((item) => item.type === "PERFORMANCE_RISK").length ?? 0;
  const consistencyIssues = alert.alerts?.filter((item) => item.type === "SYSTEM_INCONSISTENCY" || item.type === "OVER_BLOCKING").length ?? 0;
  const observabilityIssues = gov.recommendations?.filter((item) => item.type === "OBSERVABILITY_GAP").length ?? 0;

  const patchCandidates: PatchCandidate[] = [
    {
      type: "SECURITY_HEALING",
      severity: (cli.summary?.falseNegativePercent ?? 0) > 10 ? "CRITICAL" : "HIGH",
      description: "Strengthen session and auth consistency to prevent bypasses.",
      modules: ["server/core/auth", "server/core/security/sessionGuard.ts", "server/core/http/requireAuth.ts"],
    },
    {
      type: "CONSISTENCY_HEALING",
      severity: (truth.summary?.consistencyPercent ?? 100) < 85 ? "HIGH" : "MEDIUM",
      description: "Align CLI audit baseline with runtime decision paths.",
      modules: ["scripts/cli-auth-audit.ts", "scripts/auth-truth-layer.ts", "scripts/auth-drift-dashboard.ts"],
    },
    {
      type: "ARCHITECTURE_HEALING",
      severity: architectureIssues > 0 ? "MEDIUM" : "LOW",
      description: "Consolidate duplicated auth/session middleware and wrappers.",
      modules: ["server/core/auth/authCore.service.ts", "server/middleware/auth.ts", "server/modules/auth/auth.service.ts"],
    },
    {
      type: "PERFORMANCE_HEALING",
      severity: performanceIssues > 0 || (chaos.summary?.systemStabilityScore ?? 100) < 80 ? "MEDIUM" : "LOW",
      description: "Reduce repeated read passes and batch heavy lookups.",
      modules: ["scripts/auth-governance-engine.ts", "scripts/auth-chaos-test-engine.ts", "scripts/auth-drift-alert-engine.ts"],
    },
    {
      type: "OBSERVABILITY_HEALING",
      severity: observabilityIssues > 0 || (gate.summary?.observabilityScore ?? 100) < 80 ? "MEDIUM" : "LOW",
      description: "Standardize structured diagnostics across auth pipeline.",
      modules: ["server/modules/auth/auth.controller.ts", "server/core/auth/authCore.service.ts", "scripts/output"],
    },
  ];

  const patches = patchCandidates.map((issue) => generateHealingPlan(issue));
  const totalIssues = patchCandidates.length;

  const report = {
    globalHealingReport: {
      totalIssues,
      securityIssues,
      architectureIssues,
      performanceIssues,
      consistencyIssues,
      observabilityIssues,
    },
    patchCandidates: patches,
    priorityHealingRoadmap: [
      "CRITICAL SECURITY FIXES",
      "CONSISTENCY ALIGNMENT (CLI vs Runtime)",
      "ARCHITECTURE CONSOLIDATION",
      "PERFORMANCE OPTIMIZATION",
      "OBSERVABILITY IMPROVEMENTS",
    ],
    context: {
      productionVerdict: gate.verdict ?? "UNKNOWN",
      chaosScore: chaos.summary?.chaosScore ?? 0,
      trustScore: truth.summary?.trustScore ?? 0,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});