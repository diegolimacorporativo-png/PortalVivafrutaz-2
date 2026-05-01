import { startEmailScheduler } from "../routes/email-scheduler.ts";

export function initSchedulers(): void {
  startEmailScheduler();
}
