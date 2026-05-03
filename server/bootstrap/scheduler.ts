import { startEmailScheduler } from "../routes/email-scheduler.ts";
import { startContinuousAuditScheduler } from "../core/security/continuousAudit";

export function initSchedulers(): void {
  startEmailScheduler();
  startContinuousAuditScheduler();
}
