/**
 * STEP 9.2Z.1C — Agregador de Dry-Run (sem banco, sem UI).
 *
 * Captura em memória os eventos que SERIAM bloqueados pelo faturamento,
 * enquanto BILLING_DRY_RUN=true e BILLING_STRICT_MODE=false.
 *
 * LIMITAÇÕES ACEITAS:
 *  - reinicia ao subir servidor
 *  - não é histórico permanente
 *  - não é BI
 */

export type DryRunEvent = {
  orderId: number;
  tipo: string;
  motivo: string;
  at: number;
};

const MAX_EVENTS = 200;

const metrics = {
  total: 0,
  byTipo: {} as Record<string, number>,
  events: [] as DryRunEvent[],
};

export function recordDryRun(event: DryRunEvent): void {
  metrics.total++;

  metrics.byTipo[event.tipo] = (metrics.byTipo[event.tipo] || 0) + 1;

  metrics.events.unshift(event);

  if (metrics.events.length > MAX_EVENTS) {
    metrics.events.pop();
  }
}

export function getDryRunMetrics() {
  return {
    total: metrics.total,
    byTipo: { ...metrics.byTipo },
    events: [...metrics.events],
  };
}
