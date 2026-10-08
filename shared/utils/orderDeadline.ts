export interface DeadlineResult {
  deadline: Date;
  canModify: boolean;
  reason: string;
}

export interface DeadlineOptions {
  /** Allows deterministic boundary tests. */
  now?: Date;
}

/**
 * Business cutoff: 12:00 America/Sao_Paulo on the second business day before
 * delivery. Delivery dates are persisted as timestamps; their UTC calendar
 * date is the canonical delivery day used by the application.
 */
export function calculateOrderModificationDeadline(
  deliveryDate: Date | string,
  options: DeadlineOptions = {},
): DeadlineResult {
  const delivery = new Date(deliveryDate);
  if (!Number.isFinite(delivery.getTime())) {
    throw new RangeError("Data de entrega inválida");
  }

  const deadlineDay = new Date(
    Date.UTC(
      delivery.getUTCFullYear(),
      delivery.getUTCMonth(),
      delivery.getUTCDate(),
    ),
  );

  let businessDaysToSubtract = 2;
  while (businessDaysToSubtract > 0) {
    deadlineDay.setUTCDate(deadlineDay.getUTCDate() - 1);
    const day = deadlineDay.getUTCDay();
    if (day !== 0 && day !== 6) businessDaysToSubtract--;
  }

  // São Paulo is UTC-3: noon local time is 15:00 UTC.
  deadlineDay.setUTCHours(15, 0, 0, 0);

  const now = options.now ?? new Date();
  const canModify = now.getTime() <= deadlineDay.getTime();
  return {
    deadline: deadlineDay,
    canModify,
    reason: canModify ? "" : "Prazo operacional para alterações expirado.",
  };
}

export const ORDER_MODIFICATION_EXPIRED_MESSAGE =
  "O prazo para solicitar alterações ou cancelamentos deste pedido foi encerrado.\n\n" +
  "Para pedidos com entrega em dias úteis, alterações são permitidas somente até às 12h00 do último dia útil permitido antes da entrega.\n\n" +
  "Caso necessite de atendimento excepcional, entre em contato com nossa equipe comercial.";

export const REOPENED_ORDER_EXPIRED_MESSAGE =
  "Este pedido foi reaberto, porém o prazo operacional para alterações já expirou.";
