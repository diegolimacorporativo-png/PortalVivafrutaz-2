/**
 * STEP 9.3D — Store em memória do estado do cron de faturamento.
 *
 * Camada de OBSERVABILIDADE (não toca lógica do cron):
 *   - última execução
 *   - se está rodando agora
 *   - resumo da última execução (total/success/blocked/errors)
 *
 * LIMITAÇÕES ACEITAS:
 *  - reinicia ao subir o servidor
 *  - escopo de processo (não compartilha entre instâncias)
 *  - histórico permanente fica para STEP 9.3E (banco)
 */

export type CronSummary = {
  total: number;
  success: number;
  blocked: number;
  errors: number;
};

export type CronStatus = {
  lastRunAt: Date | null;
  lastFinishedAt: Date | null;
  lastTriggeredBy: "schedule" | "manual" | null;
  running: boolean;
  summary: CronSummary | null;
};

const status: CronStatus = {
  lastRunAt: null,
  lastFinishedAt: null,
  lastTriggeredBy: null,
  running: false,
  summary: null,
};

export function setCronRunning(
  running: boolean,
  triggeredBy: "schedule" | "manual" = "schedule",
): void {
  status.running = running;
  if (running) {
    status.lastRunAt = new Date();
    status.lastTriggeredBy = triggeredBy;
  }
}

export function setCronResult(summary: CronSummary): void {
  status.lastFinishedAt = new Date();
  status.summary = summary;
  status.running = false;
}

export function getCronStatus(): CronStatus {
  return {
    lastRunAt: status.lastRunAt,
    lastFinishedAt: status.lastFinishedAt,
    lastTriggeredBy: status.lastTriggeredBy,
    running: status.running,
    summary: status.summary ? { ...status.summary } : null,
  };
}

export function isCronRunning(): boolean {
  return status.running;
}
