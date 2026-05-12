/**
 * FASE NF-e 1.2 — T1205: Fiscal Store (in-memory)
 *
 * Ring-buffer de eventos fiscais recentes + contadores agregados.
 * Não persiste no banco. Thread-safe no single-thread de Node.js.
 *
 * Exposto via GET /api/admin/observability/fiscal (MASTER only).
 *
 * Garantias de memória:
 *   - Ring buffer: máximo MAX_EVENTS entradas (padrão 100)
 *   - Campos por evento: tipos primitivos apenas (sem payloads, sem XML)
 *   - Contadores: O(1) — chaves fixas
 */

export type FiscalEventKind =
  | "emission_start"
  | "emission_ok"
  | "emission_rejected"
  | "emission_error"
  | "cancel_ok"
  | "cancel_error"
  | "cce_ok"
  | "cce_error"
  | "cert_ok"
  | "cert_warning"
  | "cert_expired"
  | "xml_guard_fail"
  | "circuit_open"
  | "circuit_closed"
  | "sefaz_timeout"
  | "sefaz_down";

export interface FiscalEvent {
  id: number;
  kind: FiscalEventKind;
  ts: number; // Unix ms
  requestId?: string;
  orderId?: number;
  chaveNFe?: string;
  tenantId?: number;
  uf?: string;
  ambiente?: "producao" | "homologacao";
  cStat?: string;
  xMotivo?: string;
  durationMs?: number;
  certDaysLeft?: number;
  errorMessage?: string;
}

export interface FiscalCounters {
  emissionsTotal: number;
  emissionsOk: number;
  emissionsRejected: number;
  emissionsError: number;
  cancelsOk: number;
  cancelsError: number;
  cceOk: number;
  cceError: number;
  sefazTimeouts: number;
  sefazDownEvents: number;
  certWarnings: number;
  certExpiredBlocks: number;
  xmlGuardBlocks: number;
  circuitOpenings: number;
}

interface FiscalSummary {
  lastEmissionAt?: number;
  lastAuthAt?: number;
  lastRejectionAt?: number;
  lastSefazTimeoutAt?: number;
  avgEmissionMs?: number;
  totalEmissionMsSamples: number;
  totalEmissionMsSum: number;
}

const MAX_EVENTS = 100;

let _seq = 0;
const _events: FiscalEvent[] = [];

const _counters: FiscalCounters = {
  emissionsTotal: 0,
  emissionsOk: 0,
  emissionsRejected: 0,
  emissionsError: 0,
  cancelsOk: 0,
  cancelsError: 0,
  cceOk: 0,
  cceError: 0,
  sefazTimeouts: 0,
  sefazDownEvents: 0,
  certWarnings: 0,
  certExpiredBlocks: 0,
  xmlGuardBlocks: 0,
  circuitOpenings: 0,
};

const _summary: FiscalSummary = {
  totalEmissionMsSamples: 0,
  totalEmissionMsSum: 0,
};

const _since = new Date().toISOString();

// ── Emit ─────────────────────────────────────────────────────────────────────

export function emitFiscalEvent(event: Omit<FiscalEvent, "id" | "ts">): void {
  const entry: FiscalEvent = { id: ++_seq, ts: Date.now(), ...event };

  // Ring buffer
  if (_events.length >= MAX_EVENTS) {
    _events.shift();
  }
  _events.push(entry);

  // Counters
  switch (event.kind) {
    case "emission_start":  _counters.emissionsTotal++; break;
    case "emission_ok":     _counters.emissionsOk++; _summary.lastAuthAt = entry.ts; break;
    case "emission_rejected": _counters.emissionsRejected++; _summary.lastRejectionAt = entry.ts; break;
    case "emission_error":  _counters.emissionsError++; break;
    case "cancel_ok":       _counters.cancelsOk++; break;
    case "cancel_error":    _counters.cancelsError++; break;
    case "cce_ok":          _counters.cceOk++; break;
    case "cce_error":       _counters.cceError++; break;
    case "sefaz_timeout":   _counters.sefazTimeouts++; _summary.lastSefazTimeoutAt = entry.ts; break;
    case "sefaz_down":      _counters.sefazDownEvents++; break;
    case "cert_warning":    _counters.certWarnings++; break;
    case "cert_expired":    _counters.certExpiredBlocks++; break;
    case "xml_guard_fail":  _counters.xmlGuardBlocks++; break;
    case "circuit_open":    _counters.circuitOpenings++; break;
  }

  // Summary: last emission + avg latency
  if (event.kind === "emission_start") {
    _summary.lastEmissionAt = entry.ts;
  }
  if ((event.kind === "emission_ok" || event.kind === "emission_error" || event.kind === "emission_rejected") && event.durationMs) {
    _summary.totalEmissionMsSamples++;
    _summary.totalEmissionMsSum += event.durationMs;
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

export interface FiscalStoreSnapshot {
  counters: FiscalCounters;
  summary: {
    lastEmissionAt: number | undefined;
    lastAuthAt: number | undefined;
    lastRejectionAt: number | undefined;
    lastSefazTimeoutAt: number | undefined;
    avgEmissionMs: number | null;
  };
  recentEvents: FiscalEvent[];
  since: string;
}

export function getFiscalSnapshot(): FiscalStoreSnapshot {
  const avgMs =
    _summary.totalEmissionMsSamples > 0
      ? Math.round(_summary.totalEmissionMsSum / _summary.totalEmissionMsSamples)
      : null;

  return {
    counters: { ..._counters },
    summary: {
      lastEmissionAt: _summary.lastEmissionAt,
      lastAuthAt: _summary.lastAuthAt,
      lastRejectionAt: _summary.lastRejectionAt,
      lastSefazTimeoutAt: _summary.lastSefazTimeoutAt,
      avgEmissionMs: avgMs,
    },
    recentEvents: [..._events].reverse(), // newest first
    since: _since,
  };
}

export function resetFiscalStore(): void {
  _events.length = 0;
  Object.assign(_counters, {
    emissionsTotal: 0,
    emissionsOk: 0,
    emissionsRejected: 0,
    emissionsError: 0,
    cancelsOk: 0,
    cancelsError: 0,
    cceOk: 0,
    cceError: 0,
    sefazTimeouts: 0,
    sefazDownEvents: 0,
    certWarnings: 0,
    certExpiredBlocks: 0,
    xmlGuardBlocks: 0,
    circuitOpenings: 0,
  });
  Object.assign(_summary, {
    lastEmissionAt: undefined,
    lastAuthAt: undefined,
    lastRejectionAt: undefined,
    lastSefazTimeoutAt: undefined,
    totalEmissionMsSamples: 0,
    totalEmissionMsSum: 0,
  });
}
