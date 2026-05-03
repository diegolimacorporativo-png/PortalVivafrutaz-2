import { randomUUID } from "node:crypto";
import { eventRepository } from "../events/event.repository";
import { protectiveModeService } from "../security/protective-mode.service";
import { notifyAlert } from "./alert-notifier";
import type { RealtimeRiskState } from "../events/realtime-state.store";

let lastAlertKey = "";

export async function evaluateRisk(state: RealtimeRiskState) {
  const alerts = [];
  if (state.authRisk > 60) {
    alerts.push({
      type: "BRUTE_FORCE_DETECTED",
      severity: state.authRisk > 80 ? "HIGH" : "MEDIUM",
      actionsTriggered: ["notify_admin", "increase_rate_sensitivity"],
    });
  }
  if (state.sessionRisk > 55) {
    alerts.push({
      type: "SESSION_ANOMALY",
      severity: "MEDIUM",
      actionsTriggered: ["notify_admin", "force_session_revalidation_flag"],
    });
  }
  if (state.nfeRisk > 60) {
    alerts.push({
      type: "NF_E_FAILURE_STORM",
      severity: "CRITICAL",
      actionsTriggered: ["notify_operator", "soft_throttle_retry_queue"],
    });
  }
  if (state.securityRisk > 70) {
    alerts.push({
      type: "SECURITY_THREAT",
      severity: "CRITICAL",
      actionsTriggered: ["notify_admin", "enable_protective_mode"],
    });
    protectiveModeService.setLevel("ELEVATED");
  }
  if (state.globalRisk > 75) {
    alerts.push({
      type: "RISK_SPIKE",
      severity: "HIGH",
      actionsTriggered: ["notify_admin"],
    });
  }
  if (state.globalRisk > 90) {
    protectiveModeService.setLevel("LOCKDOWN");
  }
  for (const alert of alerts) {
    const key = `${alert.type}:${alert.severity}:${state.globalRisk}`;
    if (key === lastAlertKey) continue;
    lastAlertKey = key;
    const row = {
      id: randomUUID(),
      type: alert.type,
      severity: alert.severity,
      entityType: undefined,
      entityId: undefined,
      metadata: { state, actionsTriggered: alert.actionsTriggered },
    };
    await eventRepository.saveAlert(row as any);
    notifyAlert(alert.type, alert.severity, row.metadata as Record<string, any>);
  }
}