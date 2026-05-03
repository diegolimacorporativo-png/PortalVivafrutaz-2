import { systemState } from "../state/system-state";

export type RealtimeRiskState = {
  authRisk: number;
  sessionRisk: number;
  nfeRisk: number;
  securityRisk: number;
  globalRisk: number;
  rollingWindows: {
    authFailures: any[];
    nfeFailures: any[];
    securityEvents: any[];
    sessionInvalids: any[];
  };
  protectiveMode: {
    enabled: boolean;
    level: "NORMAL" | "ELEVATED" | "LOCKDOWN";
  };
};

export const realtimeState: RealtimeRiskState = new Proxy({} as any, {
  get(_target, prop) {
    const s = systemState.get();
    if (prop === "authRisk")     return s.risk.auth;
    if (prop === "sessionRisk")  return s.risk.session;
    if (prop === "nfeRisk")      return s.risk.nfe;
    if (prop === "securityRisk") return s.risk.security;
    if (prop === "globalRisk")   return s.risk.global;
    if (prop === "protectiveMode") return { enabled: s.protectiveMode !== "NORMAL", level: s.protectiveMode };
    if (prop === "rollingWindows") return { authFailures: [], nfeFailures: [], securityEvents: [], sessionInvalids: [] };
    return undefined;
  },
  set() { return true; },
});

export function pushWindow(_window: any[], _event: any) {}
export function pruneWindow(window: any[], _cutoffMs: number) { return window; }
