import { eventRepository } from "./event.repository";
import type { EventRiskAnalysis } from "./event-analytics.engine";

let lastGlobalRisk = -1;
let pendingEvents = 0;

export async function persistSnapshotIfNeeded(analysis: EventRiskAnalysis) {
  pendingEvents += 1;
  const riskDelta = Math.abs(analysis.riskScores.global - lastGlobalRisk);
  if (riskDelta < 5 && pendingEvents < 10) return;
  pendingEvents = 0;
  lastGlobalRisk = analysis.riskScores.global;
  await eventRepository.saveRiskSnapshot({
    globalRiskScore: analysis.riskScores.global,
    authRiskScore: analysis.riskScores.auth,
    sessionRiskScore: analysis.riskScores.session,
    nfeRiskScore: analysis.riskScores.nfe,
    securityRiskScore: analysis.riskScores.security,
    anomalies: analysis.anomalies,
  });
}