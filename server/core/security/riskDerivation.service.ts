/**
 * FASE 14.9 — Risk Derivation Layer.
 * FASE 14.X  — Thin adapter over SecurityAnalyticsEngine.
 *
 * All logic now lives in securityAnalytics.engine.ts.
 * This file is kept for backward compatibility with any callers that
 * import computeAllCompanyRisks / computeAccountRisk directly.
 *
 * PRINCIPLE: "There is only ONE security brain."
 */

import { runSecurityAnalytics } from "./securityAnalytics.engine";

export interface RiskBreakdown {
  failedLogins:     number;
  successLogins:    number;
  ipDiversity:      number;
  targetSpread:     number;
  bruteForceSignal: boolean;
}

export interface AccountRiskResult {
  companyId: number;
  riskScore:  number;
  breakdown:  RiskBreakdown;
}

/** Delegates to the engine — returns all company risks from a 7d window. */
export async function computeAllCompanyRisks(): Promise<AccountRiskResult[]> {
  const report = await runSecurityAnalytics(7);
  return report.companyRisks;
}

/**
 * Point lookup — runs the engine over 7d and extracts the specific company.
 * Returns null if the company had no auth_attempts in the window.
 */
export async function computeAccountRisk(
  companyId?: number,
  _userId?: number,
): Promise<AccountRiskResult | null> {
  if (!companyId) return null;
  const report = await runSecurityAnalytics(7);
  return report.companyRisks.find(r => r.companyId === companyId) ?? null;
}
