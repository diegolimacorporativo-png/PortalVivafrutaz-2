/**
 * Regra de prazo para alteração / cancelamento / reabertura de pedidos.
 *
 * Prazo: até às 12:00 BRT (15:00 UTC) do SEGUNDO DIA ÚTIL anterior à entrega.
 * Dias úteis: segunda a sexta. Sábado e domingo são ignorados.
 * Feriados: parâmetro `holidays` reservado para implementação futura.
 *
 * TODOS os pontos de ação (editar, solicitar alteração, solicitar cancelamento,
 * solicitar reabertura) devem usar exclusivamente esta função — sem duplicação
 * de regra em outros arquivos.
 */

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export interface DeadlineResult {
  /** Data/hora limite: 12:00 BRT (15:00 UTC) do 2º dia útil antes da entrega */
  deadline: Date;
  /** true quando now ≤ deadline (dentro do prazo) */
  canModify: boolean;
  /** Motivo do bloqueio quando canModify = false; string vazia quando dentro do prazo */
  reason: string;
}

export interface DeadlineOptions {
  /**
   * Lista de feriados a serem ignorados como dias úteis.
   * Reservado para suporte futuro — ainda não aplicado ao cálculo.
   */
  holidays?: Date[];
  /** Sobrescreve "agora" — útil exclusivamente em testes unitários */
  now?: Date;
}

export type DeadlineAction =
  | "edit"
  | "request-change"
  | "request-cancellation"
  | "reopen";

export interface DeadlineAuditPayload {
  orderId: number;
  companyId?: number | null;
  userId?: number | null;
  now: string;
  deadline: string;
  canModify: boolean;
  reason: string;
  action: DeadlineAction;
}

// ─── Função interna ────────────────────────────────────────────────────────────

/**
 * Retrocede `n` dias úteis (seg–sex) a partir de `date`.
 * Sábado (UTC day 6) e domingo (UTC day 0) são pulados.
 *
 * @param date     Ponto de partida
 * @param n        Quantidade de dias úteis a retroceder
 * @param _holidays Reservado — nenhuma verificação de feriado ainda
 */
function subtractBusinessDays(date: Date, n: number, _holidays: Date[] = []): Date {
  const result = new Date(date);
  let remaining = n;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() - 1);
    const dow = result.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      // TODO: quando holidays for implementado, verificar colisão aqui também
      remaining--;
    }
  }
  return result;
}

// ─── API pública ───────────────────────────────────────────────────────────────

/**
 * Calcula o prazo para alteração / cancelamento / reabertura de um pedido.
 *
 * **Regra:** prazo = segundo dia útil anterior à entrega às 12:00 BRT (15:00 UTC).
 *
 * @example
 * // Entrega segunda 03/08/2026 → prazo quinta 31/07/2026 às 12:00 BRT
 * calculateOrderModificationDeadline("2026-08-04")
 * // { deadline: Date("2026-07-31T15:00:00Z"), canModify: ..., reason: "..." }
 *
 * @param deliveryDate Data de entrega (Date ou string ISO/YYYY-MM-DD)
 * @param options      { holidays?: Date[]; now?: Date }
 */
export function calculateOrderModificationDeadline(
  deliveryDate: Date | string,
  options: DeadlineOptions = {},
): DeadlineResult {
  const { holidays = [], now = new Date() } = options;

  const delivery = new Date(deliveryDate);
  const deadlineDay = subtractBusinessDays(delivery, 2, holidays);

  const deadline = new Date(deadlineDay);
  deadline.setUTCHours(15, 0, 0, 0); // 12:00 BRT = UTC-3 → 15:00 UTC

  const canModify = now <= deadline;
  const reason = canModify
    ? ""
    : "Prazo encerrado: alterações são permitidas somente até às 12h00 do segundo dia útil anterior à data de entrega.";

  return { deadline, canModify, reason };
}

// ─── Auditoria ─────────────────────────────────────────────────────────────────

/**
 * Envia um registro de auditoria ao servidor (fire-and-forget).
 *
 * - Nunca lança exceção; erros de rede são silenciados.
 * - O servidor registra via logger.info sem alterar banco de dados.
 *
 * @param payload Dados do registro: pedido, empresa, usuário, datas, resultado
 */
export function logDeadlineAudit(payload: DeadlineAuditPayload): void {
  fetch(`/api/orders/${payload.orderId}/deadline-audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  }).catch(() => {
    // Silently ignore — erros de rede nunca devem bloquear a UX
  });
}
