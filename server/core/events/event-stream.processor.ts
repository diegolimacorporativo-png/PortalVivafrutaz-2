import type { SystemEvent } from "./event.emitter";
import { analyzeEvents } from "./event-analytics.engine";
import { persistSnapshotIfNeeded } from "./realtime-snapshot.writer";
import { pruneWindow, pushWindow, realtimeState } from "./realtime-state.store";

const HOT = 60_000;
const MEDIUM = 5 * 60_000;
const GLOBAL = 15 * 60_000;

export async function processEventStream(event: SystemEvent) {
  const rolling = realtimeState.rollingWindows;
  const base = {
    id: event.id,
    type: event.type,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    createdAt: event.timestamp,
  };

  if (event.type === "AUTH_LOGIN_FAILURE") {
    realtimeState.authRisk += 2;
    pushWindow(rolling.authFailures, base);
  }
  if (event.type === "SESSION_INVALID") {
    realtimeState.sessionRisk += 3;
    pushWindow(rolling.sessionInvalids, base);
  }
  if (event.type === "NF_E_FAILED") {
    realtimeState.nfeRisk += 3;
    pushWindow(rolling.nfeFailures, base);
  }
  if (event.type === "SECURITY_ANOMALY") {
    realtimeState.securityRisk += 5;
    pushWindow(rolling.securityEvents, base);
  }

  rolling.authFailures = pruneWindow(rolling.authFailures, HOT);
  rolling.sessionInvalids = pruneWindow(rolling.sessionInvalids, MEDIUM);
  rolling.nfeFailures = pruneWindow(rolling.nfeFailures, MEDIUM);
  rolling.securityEvents = pruneWindow(rolling.securityEvents, GLOBAL);

  const analysis = analyzeEvents([
    ...rolling.authFailures,
    ...rolling.sessionInvalids,
    ...rolling.nfeFailures,
    ...rolling.securityEvents,
  ] as any);

  realtimeState.authRisk = analysis.riskScores.auth;
  realtimeState.sessionRisk = analysis.riskScores.session;
  realtimeState.nfeRisk = analysis.riskScores.nfe;
  realtimeState.securityRisk = analysis.riskScores.security;
  realtimeState.globalRisk = analysis.riskScores.global;

  await persistSnapshotIfNeeded(analysis);
}