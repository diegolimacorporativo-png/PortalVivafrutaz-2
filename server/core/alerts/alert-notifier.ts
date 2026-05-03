import { logSecurity } from "../security/securityLogger";

export function notifyAlert(type: string, severity: string, metadata?: Record<string, any>) {
  logSecurity(`[ALERT] ${type} | severity=${severity} | metadata=${JSON.stringify(metadata ?? {})}`);
}