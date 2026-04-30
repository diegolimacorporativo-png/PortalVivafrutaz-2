/**
 * FASE 8.6E — MÉTRICAS DE DEFAULTS FISCAIS (in-memory ring buffer)
 *
 * Converte os logs `[FISCAL_DEFAULT_APPLIED]` (FASE 8.6D) em
 * estrutura consultável via endpoint admin, sem depender do banco
 * (sem persistência) e sem alterar o comportamento do builder.
 *
 * Design:
 *   • Contadores monotônicos por campo (`uCom`, `csosn`, `cst`).
 *   • Ring buffer de até `MAX_EVENTS` ocorrências mais recentes
 *     (FIFO — `shift()` quando excede).
 *   • Vive no escopo do processo: zera em deploy/restart, sem custo
 *     de I/O e sem risco de OOM (200 eventos × ~80 bytes ≈ 16 KB).
 *   • API mínima e estável (`recordFiscalDefault`,
 *     `getFiscalDefaultsStats`, `resetFiscalDefaultsStats`).
 *
 * NÃO bloqueia, NÃO depende de tenant, NÃO aciona NFe — pura
 * telemetria. Acoplamento zero com o restante do sistema.
 */

export type FiscalField = "uCom" | "csosn" | "cst";

export interface FiscalDefaultEvent {
  field: FiscalField;
  orderId: number;
  itemIndex: number;
  ts: number;
}

const MAX_EVENTS = 200;

const state = {
  counts: {
    uCom: 0,
    csosn: 0,
    cst: 0,
  } as Record<FiscalField, number>,
  events: [] as FiscalDefaultEvent[],
};

/**
 * Registra uma ocorrência de default fiscal aplicado.
 * Chamado pelo helper `logFiscalDefault` em `nfe-input.builder.ts`.
 */
export function recordFiscalDefault(e: FiscalDefaultEvent): void {
  state.counts[e.field] = (state.counts[e.field] ?? 0) + 1;
  state.events.push(e);
  if (state.events.length > MAX_EVENTS) {
    state.events.shift();
  }
}

export interface FiscalDefaultsStats {
  counts: Record<FiscalField, number>;
  recent: FiscalDefaultEvent[];
  bufferSize: number;
  bufferCapacity: number;
}

/**
 * Snapshot atual da telemetria. Devolve cópias defensivas para evitar
 * que o caller mute o estado interno.
 */
export function getFiscalDefaultsStats(): FiscalDefaultsStats {
  return {
    counts: { ...state.counts },
    // Mais recentes primeiro — facilita inspeção visual no admin.
    recent: state.events.slice().reverse(),
    bufferSize: state.events.length,
    bufferCapacity: MAX_EVENTS,
  };
}

/**
 * Reseta contadores e ring buffer. Útil após corrigir cadastros para
 * medir o impacto da correção sem esperar o ciclo natural do buffer.
 */
export function resetFiscalDefaultsStats(): void {
  state.counts.uCom = 0;
  state.counts.csosn = 0;
  state.counts.cst = 0;
  state.events.length = 0;
}
