/**
 * alert-engine — compatibility re-export.
 *
 * SOURCE OF TRUTH: server/core/alerts/risk-evaluator.ts
 *
 * This file has been renamed to risk-evaluator.ts to avoid confusion with
 * server/core/security/alertEngine.ts (the operational in-memory alert buffer).
 *
 * NAMING CLARIFICATION:
 *   server/core/security/alertEngine.ts  = operational in-memory alert buffer
 *                                          (pushAlert, getAlerts, classify)
 *   server/core/alerts/risk-evaluator.ts = policy decision engine re-export
 *                                          (evaluateRisk / makeDecisions)
 *
 * For NEW code, import from the canonical location:
 *   import { evaluateRisk } from "../alerts/risk-evaluator"
 *
 * @deprecated — import from server/core/alerts/risk-evaluator.ts directly.
 */
export { evaluateRisk } from "./risk-evaluator";
