/**
 * FASE 14.11 — Real-Time Anomaly Detection.
 * FASE 14.X  — Thin adapter over SecurityAnalyticsEngine.
 *
 * All detection logic now lives in securityAnalytics.engine.ts.
 * This file is kept for backward compatibility with any callers that
 * import detectAnomalies directly.
 *
 * PRINCIPLE: "Anomaly Detection is derived intelligence, not a system."
 */

import { runSecurityAnalytics } from "./securityAnalytics.engine";
import type { AnomalyType, AnomalySeverity, Anomaly } from "./securityAnalytics.engine";

export type { AnomalyType, AnomalySeverity, Anomaly };

export interface AnomalyReport {
  generatedAt:      string;
  window:           "24h";
  globalRiskSignal: number;
  anomalies:        Anomaly[];
}

/** Delegates to the engine — extracts the anomaly section from a 1-day run. */
export async function detectAnomalies(): Promise<AnomalyReport> {
  const report = await runSecurityAnalytics(1);
  return report.anomalies;
}
