/**
 * risk-evaluator — re-exposes the decision engine's risk evaluation function.
 *
 * PURPOSE: Provides a named entry-point for callers that want to evaluate
 * risk decisions without importing the full decision engine directly.
 *
 * DISTINCT FROM: server/core/security/alertEngine.ts
 *   That file is the OPERATIONAL alert engine — an in-memory buffer that
 *   accumulates, deduplicates, and classifies security/operational events
 *   (pushAlert, getAlerts). It has no relation to policy decisions.
 *   This file evaluates risk decisions via the policy decision engine.
 *
 * Export:
 *   evaluateRisk — alias for makeDecisions from decision.engine
 */
export { makeDecisions as evaluateRisk } from "../decision/decision.engine";
