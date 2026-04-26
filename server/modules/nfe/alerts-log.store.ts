/**
 * STEP 9.3F.3 — Store em memória dos alertas disparados.
 *
 * Mantém os últimos N (default 200) eventos do `emitAlert(...)` para auditoria
 * via dashboard. Sem persistência (volátil entre restarts) — a versão em
 * banco virá no STEP 9.3F.4.
 *
 * REGRA: este arquivo é só observabilidade. Não decide, não envia, não
 * influencia o fluxo do cron.
 */

export type AlertLogChannelResult = {
  channel: "email" | "slack" | "whatsapp";
  target?: string;
  ok: boolean;
  reason?: string;
};

export type AlertLog = {
  at: number;
  severity: "ALERT" | "CRITICAL";
  title: string;
  message: string;
  results: AlertLogChannelResult[];
  rateLimited?: boolean;
};

const MAX_LOGS = 200;
const logs: AlertLog[] = [];

export function recordAlertLog(entry: AlertLog): void {
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
}

/** Retorna cópia defensiva (mais recente primeiro). */
export function getAlertLogs(): AlertLog[] {
  return logs.slice();
}

/** Limpa o store (uso em testes ou ação admin futura). */
export function clearAlertLogs(): void {
  logs.length = 0;
}
