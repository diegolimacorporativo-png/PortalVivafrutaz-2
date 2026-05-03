type RollingEvent = {
  id: string;
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  createdAt: Date;
};

export type RealtimeRiskState = {
  authRisk: number;
  sessionRisk: number;
  nfeRisk: number;
  securityRisk: number;
  globalRisk: number;
  rollingWindows: {
    authFailures: RollingEvent[];
    nfeFailures: RollingEvent[];
    securityEvents: RollingEvent[];
    sessionInvalids: RollingEvent[];
  };
};

const MAX_WINDOW = 250;

export const realtimeState: RealtimeRiskState = {
  authRisk: 0,
  sessionRisk: 0,
  nfeRisk: 0,
  securityRisk: 0,
  globalRisk: 0,
  rollingWindows: {
    authFailures: [],
    nfeFailures: [],
    securityEvents: [],
    sessionInvalids: [],
  },
};

export function pushWindow(window: RollingEvent[], event: RollingEvent) {
  window.push(event);
  if (window.length > MAX_WINDOW) window.shift();
}

export function pruneWindow(window: RollingEvent[], cutoffMs: number) {
  const cutoff = Date.now() - cutoffMs;
  return window.filter((event) => event.createdAt.getTime() >= cutoff);
}