import { randomUUID } from "node:crypto";
import { systemState, type ProtectiveLevel } from "../state/system-state";
import { eventRepository } from "../events/event.repository";
import { loadEnabledPolicies } from "../policy/policy-cache";
import { logSecurity } from "../security/securityLogger";

type RuleAlert = {
  type: string;
  severity: string;
  actionsTriggered: string[];
  protectiveModeEscalation?: ProtectiveLevel;
};

function buildRuleAlerts(): RuleAlert[] {
  const s = systemState.get();
  const results: RuleAlert[] = [];

  if (s.risk.auth > 60) {
    results.push({
      type: "BRUTE_FORCE_DETECTED",
      severity: s.risk.auth > 80 ? "HIGH" : "MEDIUM",
      actionsTriggered: ["notify_admin", "increase_rate_sensitivity"],
    });
  }
  if (s.risk.session > 55) {
    results.push({
      type: "SESSION_ANOMALY",
      severity: "MEDIUM",
      actionsTriggered: ["notify_admin", "force_session_revalidation_flag"],
    });
  }
  if (s.risk.nfe > 60) {
    results.push({
      type: "NF_E_FAILURE_STORM",
      severity: "CRITICAL",
      actionsTriggered: ["notify_operator", "soft_throttle_retry_queue"],
    });
  }
  if (s.risk.security > 70) {
    results.push({
      type: "SECURITY_THREAT",
      severity: "CRITICAL",
      actionsTriggered: ["notify_admin", "enable_protective_mode"],
      protectiveModeEscalation: "ELEVATED",
    });
  }
  if (s.risk.global > 75) {
    results.push({
      type: "RISK_SPIKE",
      severity: "HIGH",
      actionsTriggered: ["notify_admin"],
    });
  }
  if (s.risk.global > 90) {
    results.push({
      type: "SYSTEM_DEGRADATION",
      severity: "CRITICAL",
      actionsTriggered: ["notify_admin", "lockdown"],
      protectiveModeEscalation: "LOCKDOWN",
    });
  }
  return results;
}

async function applyPolicyRules(alertType: string): Promise<ProtectiveLevel | undefined> {
  try {
    const s = systemState.get();
    const policies = await loadEnabledPolicies(alertType);
    let escalation: ProtectiveLevel | undefined;
    for (const policy of policies) {
      const cond = policy.condition as any;
      if (cond?.event && cond.event !== alertType) continue;
      const thresh = cond?.threshold;
      if (typeof thresh === "number") {
        if (alertType.startsWith("AUTH")     && s.risk.auth     < thresh) continue;
        if (alertType.startsWith("NF_E")     && s.risk.nfe      < thresh) continue;
        if (alertType.startsWith("SESSION")  && s.risk.session  < thresh) continue;
        if (alertType.startsWith("SECURITY") && s.risk.security < thresh) continue;
      }
      const pm = (policy.action as any)?.protectiveMode as ProtectiveLevel | undefined;
      if (pm) escalation = pm;
    }
    return escalation;
  } catch {
    return undefined;
  }
}

let lastDecisionKey = "";

export async function makeDecisions(): Promise<void> {
  const ruleAlerts = buildRuleAlerts();
  if (ruleAlerts.length === 0) return;

  const topKey = ruleAlerts.map((a) => `${a.type}:${a.severity}`).join("|");
  if (topKey === lastDecisionKey) return;
  lastDecisionKey = topKey;

  for (const rule of ruleAlerts) {
    const id  = randomUUID();
    const now = new Date();

    systemState.pushAlert({
      id,
      type:             rule.type,
      severity:         rule.severity,
      createdAt:        now,
      actionsTriggered: rule.actionsTriggered,
    });

    if (rule.protectiveModeEscalation) {
      systemState.setProtectiveMode(rule.protectiveModeEscalation);
    }

    const policyEscalation = await applyPolicyRules(rule.type);
    if (policyEscalation) {
      systemState.setProtectiveMode(policyEscalation);
    }

    await eventRepository.saveAlert({
      id,
      type:       rule.type,
      severity:   rule.severity,
      entityType: null,
      entityId:   null,
      metadata:   {
        risk:             systemState.get().risk,
        actionsTriggered: rule.actionsTriggered,
        protectiveMode:   systemState.get().protectiveMode,
      },
    });

    logSecurity(
      `[DECISION] ${rule.type} | severity=${rule.severity} | protectiveMode=${systemState.get().protectiveMode}`
    );
  }

  const loadedPolicies = await loadEnabledPolicies();
  systemState.setActivePolicies(
    loadedPolicies.map((p: any) => ({
      id:       p.id,
      name:     p.name,
      type:     p.type,
      enabled:  p.enabled,
      priority: p.priority,
    }))
  );
}
