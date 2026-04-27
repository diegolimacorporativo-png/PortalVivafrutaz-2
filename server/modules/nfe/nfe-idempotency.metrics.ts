/**
 * FASE 19 — Observabilidade da regra de idempotência (FASE 18).
 *
 * Coletor in-memory de contadores agregados — apenas números, sem listas,
 * sem histórico, sem dados sensíveis (nada de requestId/orderId/payload).
 *
 * Garantias:
 *   - Memória O(1): chaves fixas (status × source × tipo). Nada cresce com volume.
 *   - Sem efeitos colaterais: só incrementa números.
 *   - Não persiste em DB.
 *   - Não bloqueia / não altera fluxo — só observa.
 *
 * Escopo: visibilidade da FASE 18 (GAP 2). Não cobre concorrência (GAP 1/7).
 */

import { NFE_BLOCKING_STATUSES } from "./nfe-idempotency.guard";

export type NFeIdempotencySource = "cron" | "emitir" | "emitir-lote";

const SOURCES: readonly NFeIdempotencySource[] = [
  "cron",
  "emitir",
  "emitir-lote",
] as const;

export type NFeIdempotencyMetrics = {
  blocked: number;
  dryRun: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  /** Marca de início da janela de coleta (reset zera para new Date()). */
  since: string;
};

// ── Estado interno ────────────────────────────────────────────────────────────
// Cardinalidade fixa: 6 status × 3 sources × 2 contadores = 36 entradas no
// pior caso. Nunca cresce com volume de requisições.

function newStatusMap(): Record<string, number> {
  const m: Record<string, number> = {};
  for (const s of NFE_BLOCKING_STATUSES) m[s] = 0;
  return m;
}

function newSourceMap(): Record<string, number> {
  const m: Record<string, number> = {};
  for (const s of SOURCES) m[s] = 0;
  return m;
}

let blockedTotal = 0;
let dryRunTotal = 0;
let byStatus: Record<string, number> = newStatusMap();
let bySource: Record<string, number> = newSourceMap();
let since: Date = new Date();

// ── API pública ──────────────────────────────────────────────────────────────

export function incrementBlocked(
  status: string,
  source: NFeIdempotencySource,
): void {
  blockedTotal += 1;
  // Defensivo: se vier um status fora da lista esperada (cenário futuro),
  // criamos a chave sob demanda — ainda assim a cardinalidade é limitada
  // pelos status possíveis em nfe_emissoes.
  byStatus[status] = (byStatus[status] ?? 0) + 1;
  bySource[source] = (bySource[source] ?? 0) + 1;
}

export function incrementDryRun(
  status: string,
  source: NFeIdempotencySource,
): void {
  dryRunTotal += 1;
  byStatus[status] = (byStatus[status] ?? 0) + 1;
  bySource[source] = (bySource[source] ?? 0) + 1;
}

export function getMetrics(): NFeIdempotencyMetrics {
  return {
    blocked: blockedTotal,
    dryRun: dryRunTotal,
    byStatus: { ...byStatus },
    bySource: { ...bySource },
    since: since.toISOString(),
  };
}

export function resetMetrics(): void {
  blockedTotal = 0;
  dryRunTotal = 0;
  byStatus = newStatusMap();
  bySource = newSourceMap();
  since = new Date();
}
