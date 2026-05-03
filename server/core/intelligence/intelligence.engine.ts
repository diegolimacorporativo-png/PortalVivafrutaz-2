import type { SystemEvent } from "../events/event.emitter";
import { systemState, type ActiveAnomaly, type Recommendation } from "../state/system-state";
import { eventRepository } from "../events/event.repository";

type RollingEvent = {
  id: string;
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  createdAt: Date;
};

const HOT    = 60_000;
const MEDIUM = 5 * 60_000;
const GLOBAL = 15 * 60_000;

const windows = {
  authFailures:    [] as RollingEvent[],
  sessionInvalids: [] as RollingEvent[],
  nfeFailures:     [] as RollingEvent[],
  securityEvents:  [] as RollingEvent[],
};

let lastSnapshotGlobal = -1;
let pendingEventCount  = 0;

function clamp(v: number) { return Math.max(0, Math.min(100, Math.round(v))); }

function push(window: RollingEvent[], event: RollingEvent, limit = 250) {
  window.push(event);
  if (window.length > limit) window.shift();
}

function prune(window: RollingEvent[], cutoffMs: number) {
  const cutoff = Date.now() - cutoffMs;
  return window.filter((e) => e.createdAt.getTime() >= cutoff);
}

function computeRisk() {
  const authFailures    = windows.authFailures;
  const sessionInvalids = windows.sessionInvalids;
  const nfeFailed       = windows.nfeFailures;
  const secAnoms        = windows.securityEvents;

  const bruteForce: ActiveAnomaly[] = authFailures.length > 5 ? [{
    type: "BRUTE_FORCE_ATTEMPT",
    severity: "HIGH",
    affectedEntity: authFailures[0]?.entityId ?? undefined,
    evidenceEvents: authFailures.slice(0, 5).map((e) => e.id),
  }] : [];

  const sessionCluster: ActiveAnomaly[] = sessionInvalids.length > 3 ? [{
    type: "SESSION_UNSTABLE_CLUSTER",
    severity: "MEDIUM",
    affectedEntity: sessionInvalids[0]?.entityId ?? undefined,
    evidenceEvents: sessionInvalids.slice(0, 5).map((e) => e.id),
  }] : [];

  const nfeLoop: ActiveAnomaly[] = nfeFailed.length > 2 ? [{
    type: "NF_E_RETRY_STORM",
    severity: "HIGH",
    affectedEntity: nfeFailed[0]?.entityId ?? undefined,
    evidenceEvents: nfeFailed.slice(0, 5).map((e) => e.id),
  }] : [];

  const secAttack: ActiveAnomaly[] = secAnoms.length > 0 && authFailures.length > 0 ? [{
    type: "SECURITY_ATTACK_PATTERN",
    severity: "CRITICAL",
    affectedEntity: secAnoms[0]?.entityId ?? undefined,
    evidenceEvents: [...secAnoms.slice(0, 3), ...authFailures.slice(0, 3)].map((e) => e.id),
  }] : [];

  const auth     = clamp(authFailures.length * 12    + bruteForce.length  * 25);
  const session  = clamp(sessionInvalids.length * 15 + sessionCluster.length * 20);
  const nfe      = clamp(nfeFailed.length * 18       + nfeLoop.length     * 25);
  const security = clamp(secAnoms.length * 20        + secAttack.length   * 30);
  const global   = clamp((auth + session + nfe + security) / 4);

  const anomalies = [...bruteForce, ...sessionCluster, ...nfeLoop, ...secAttack];
  const recommendation: Recommendation =
    global >= 80 ? "BLOCK" :
    global >= 60 ? "MITIGATE" :
    global >= 35 ? "INVESTIGATE" :
    "MONITOR";

  return { risk: { auth, session, nfe, security, global }, anomalies, recommendation };
}

async function maybePersistSnapshot(risk: ReturnType<typeof computeRisk>["risk"], anomalies: ActiveAnomaly[]) {
  pendingEventCount += 1;
  const delta = Math.abs(risk.global - lastSnapshotGlobal);
  if (delta < 5 && pendingEventCount < 10) return;
  pendingEventCount  = 0;
  lastSnapshotGlobal = risk.global;
  await eventRepository.saveRiskSnapshot({
    globalRiskScore:   risk.global,
    authRiskScore:     risk.auth,
    sessionRiskScore:  risk.session,
    nfeRiskScore:      risk.nfe,
    securityRiskScore: risk.security,
    anomalies,
  });
}

export async function processEvent(event: SystemEvent): Promise<void> {
  const base: RollingEvent = {
    id:         event.id,
    type:       event.type,
    entityType: event.entityType ?? null,
    entityId:   event.entityId   ?? null,
    createdAt:  event.timestamp,
  };

  if (event.type === "AUTH_LOGIN_FAILURE")  push(windows.authFailures,    base);
  if (event.type === "SESSION_INVALID")     push(windows.sessionInvalids,  base);
  if (event.type === "NF_E_FAILED")         push(windows.nfeFailures,      base);
  if (event.type === "SECURITY_ANOMALY")    push(windows.securityEvents,   base);

  windows.authFailures    = prune(windows.authFailures,    HOT);
  windows.sessionInvalids = prune(windows.sessionInvalids, MEDIUM);
  windows.nfeFailures     = prune(windows.nfeFailures,     MEDIUM);
  windows.securityEvents  = prune(windows.securityEvents,  GLOBAL);

  const { risk, anomalies, recommendation } = computeRisk();
  systemState.updateRisk(risk, anomalies, recommendation);
  await maybePersistSnapshot(risk, anomalies);
}
