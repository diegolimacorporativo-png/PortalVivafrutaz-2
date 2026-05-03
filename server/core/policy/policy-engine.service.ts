import { loadEnabledPolicies } from "./policy-cache";
import { protectiveModeService } from "../security/protective-mode.service";

function matchCondition(condition: any, event: any, state: any) {
  if (condition?.event && condition.event !== event?.type) return false;
  if (typeof condition?.threshold === "number") {
    if (condition.event?.startsWith("AUTH") && state.authRisk < condition.threshold) return false;
    if (condition.event?.startsWith("NF_E") && state.nfeRisk < condition.threshold) return false;
    if (condition.event?.startsWith("SESSION") && state.sessionRisk < condition.threshold) return false;
    if (condition.event?.startsWith("SECURITY") && state.securityRisk < condition.threshold) return false;
  }
  return true;
}

export async function evaluatePolicies(event: any, state: any) {
  const policies = await loadEnabledPolicies(event?.type);
  const applied: any[] = [];
  for (const policy of policies) {
    if (!matchCondition(policy.condition, event, state)) continue;
    applied.push(policy.name);
    if (policy.action?.protectiveMode) protectiveModeService.setLevel(policy.action.protectiveMode);
    if (policy.action?.type === "CREATE_ALERT") continue;
  }
  return { applied, protectiveMode: protectiveModeService.getState() };
}

export async function runPolicySimulation(policy: any) {
  const conflictsWithExistingPolicies = (await loadEnabledPolicies(policy?.type)).some((existing) => existing.name !== policy?.name && JSON.stringify(existing.condition) === JSON.stringify(policy?.condition));
  return {
    expectedAlertsIncrease: policy?.action?.type === "CREATE_ALERT" ? 1 : 0,
    riskDelta: policy?.action?.protectiveMode === "LOCKDOWN" ? 20 : policy?.action?.protectiveMode === "ELEVATED" ? 10 : 0,
    systemImpact: policy?.action?.protectiveMode === "LOCKDOWN" ? "HIGH" : "LOW",
    conflictsWithExistingPolicies,
  };
}