export type ProtectiveLevel = "NORMAL" | "ELEVATED" | "LOCKDOWN";
export type HealthStatus = "OK" | "DEGRADED" | "CRITICAL";
export type Recommendation = "MONITOR" | "INVESTIGATE" | "MITIGATE" | "BLOCK";

export type ActiveAnomaly = {
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  affectedEntity?: string;
  evidenceEvents: string[];
};

export type ActiveAlert = {
  id: string;
  type: string;
  severity: string;
  createdAt: Date;
  actionsTriggered: string[];
};

export type SystemState = {
  risk: {
    auth: number;
    session: number;
    nfe: number;
    security: number;
    global: number;
  };
  anomalies: ActiveAnomaly[];
  alerts: ActiveAlert[];
  policies: Array<{
    id: number;
    name: string;
    type: string;
    enabled: boolean;
    priority: number;
  }>;
  protectiveMode: ProtectiveLevel;
  health: HealthStatus;
  recommendation: Recommendation;
  updatedAt: Date;
};

function deriveHealth(globalRisk: number, alertCount: number): HealthStatus {
  if (globalRisk >= 75 || alertCount >= 3) return "CRITICAL";
  if (globalRisk >= 40 || alertCount >= 1) return "DEGRADED";
  return "OK";
}

const _state: SystemState = {
  risk: { auth: 0, session: 0, nfe: 0, security: 0, global: 0 },
  anomalies: [],
  alerts: [],
  policies: [],
  protectiveMode: "NORMAL",
  health: "OK",
  recommendation: "MONITOR",
  updatedAt: new Date(),
};

export const systemState = {
  get(): Readonly<SystemState> {
    return _state;
  },

  updateRisk(risk: SystemState["risk"], anomalies: ActiveAnomaly[], recommendation: Recommendation) {
    _state.risk = risk;
    _state.anomalies = anomalies;
    _state.recommendation = recommendation;
    _state.health = deriveHealth(risk.global, _state.alerts.length);
    _state.updatedAt = new Date();
  },

  pushAlert(alert: ActiveAlert) {
    _state.alerts.unshift(alert);
    if (_state.alerts.length > 50) _state.alerts.pop();
    _state.health = deriveHealth(_state.risk.global, _state.alerts.length);
    _state.updatedAt = new Date();
  },

  setProtectiveMode(level: ProtectiveLevel) {
    _state.protectiveMode = level;
    _state.updatedAt = new Date();
  },

  setActivePolicies(policies: SystemState["policies"]) {
    _state.policies = policies;
    _state.updatedAt = new Date();
  },
};
