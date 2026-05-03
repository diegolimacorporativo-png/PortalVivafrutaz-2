import { eventRepository } from "./event.repository";

type AnalyticsEvent = {
  id: string;
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: Date;
};

export type EventRiskAnalysis = {
  timestamp: Date;
  riskScores: {
    auth: number;
    session: number;
    nfe: number;
    security: number;
    global: number;
  };
  anomalies: Array<{
    type: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    affectedEntity?: string;
    evidenceEvents: string[];
  }>;
  recommendation: "MONITOR" | "INVESTIGATE" | "MITIGATE" | "BLOCK";
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function analyzeEvents(events: AnalyticsEvent[]): EventRiskAnalysis {
  const byType = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const list = byType.get(event.type) ?? [];
    list.push(event);
    byType.set(event.type, list);
  }

  const loginFailures = byType.get("AUTH_LOGIN_FAILURE") ?? [];
  const sessionInvalids = byType.get("SESSION_INVALID") ?? [];
  const nfeFailed = byType.get("NF_E_FAILED") ?? [];
  const securityAnomalies = byType.get("SECURITY_ANOMALY") ?? [];

  const bruteForce = loginFailures.length > 5 ? [{
    type: "BRUTE_FORCE_ATTEMPT",
    severity: "HIGH" as const,
    affectedEntity: loginFailures[0]?.entityId ?? undefined,
    evidenceEvents: loginFailures.slice(0, 5).map((event) => event.id),
  }] : [];

  const sessionCluster = sessionInvalids.length > 3 ? [{
    type: "SESSION_UNSTABLE_CLUSTER",
    severity: "MEDIUM" as const,
    affectedEntity: sessionInvalids[0]?.entityId ?? undefined,
    evidenceEvents: sessionInvalids.slice(0, 5).map((event) => event.id),
  }] : [];

  const nfeLoop = nfeFailed.length > 2 ? [{
    type: "NF_E_RETRY_STORM",
    severity: "HIGH" as const,
    affectedEntity: nfeFailed[0]?.entityId ?? undefined,
    evidenceEvents: nfeFailed.slice(0, 5).map((event) => event.id),
  }] : [];

  const securityAttack = securityAnomalies.length > 0 && loginFailures.length > 0 ? [{
    type: "SECURITY_ATTACK_PATTERN",
    severity: "CRITICAL" as const,
    affectedEntity: securityAnomalies[0]?.entityId ?? undefined,
    evidenceEvents: [...securityAnomalies.slice(0, 3), ...loginFailures.slice(0, 3)].map((event) => event.id),
  }] : [];

  const authRiskScore = clamp(loginFailures.length * 12 + bruteForce.length * 25);
  const sessionRiskScore = clamp(sessionInvalids.length * 15 + sessionCluster.length * 20);
  const nfeRiskScore = clamp(nfeFailed.length * 18 + nfeLoop.length * 25);
  const securityRiskScore = clamp(securityAnomalies.length * 20 + securityAttack.length * 30);
  const globalRiskScore = clamp((authRiskScore + sessionRiskScore + nfeRiskScore + securityRiskScore) / 4);

  const anomalies = [...bruteForce, ...sessionCluster, ...nfeLoop, ...securityAttack];
  const recommendation = globalRiskScore >= 80 ? "BLOCK" : globalRiskScore >= 60 ? "MITIGATE" : globalRiskScore >= 35 ? "INVESTIGATE" : "MONITOR";

  return {
    timestamp: new Date(),
    riskScores: {
      auth: authRiskScore,
      session: sessionRiskScore,
      nfe: nfeRiskScore,
      security: securityRiskScore,
      global: globalRiskScore,
    },
    anomalies,
    recommendation,
  };
}

export async function saveAnalyticsSnapshot(analysis: EventRiskAnalysis) {
  await eventRepository.saveRiskSnapshot({
    globalRiskScore: analysis.riskScores.global,
    authRiskScore: analysis.riskScores.auth,
    sessionRiskScore: analysis.riskScores.session,
    nfeRiskScore: analysis.riskScores.nfe,
    securityRiskScore: analysis.riskScores.security,
    anomalies: analysis.anomalies,
  });
}