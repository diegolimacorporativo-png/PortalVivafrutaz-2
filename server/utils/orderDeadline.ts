/**
 * Order Modification Deadline — Prazo Operacional
 *
 * Rule: modifications are allowed until 12:00 BRT (= 15:00 UTC) on the
 * second-to-last business day before the delivery date.
 *
 * Examples (business days only — Sat/Sun ignored):
 *   Monday    delivery → Thursday  12:00 BRT deadline
 *   Tuesday   delivery → Friday    12:00 BRT deadline (previous week)
 *   Wednesday delivery → Monday    12:00 BRT deadline
 *   Thursday  delivery → Tuesday   12:00 BRT deadline
 *   Friday    delivery → Wednesday 12:00 BRT deadline
 *
 * Brazil permanently uses UTC-3 (no DST since 2019), so 12:00 BRT = 15:00 UTC.
 */

export interface DeadlineResult {
  deadline: Date;
  canModify: boolean;
  reason: string;
}

/**
 * Returns the previous business day (Mon–Fri) before `date`.
 * Skips Saturday (6) and Sunday (0).
 */
function prevBusinessDay(date: Date): Date {
  const d = new Date(date);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d;
}

/**
 * Calculates the modification deadline for an order given its delivery date.
 *
 * Algorithm:
 *  1. Find the last business day before delivery (skip Sat/Sun backwards).
 *  2. Find the last business day before *that* day (skip Sat/Sun backwards).
 *  3. Deadline = step-2 day at 15:00 UTC (= 12:00 BRT).
 *
 * This equals "go back 2 business days from delivery, at noon BRT".
 */
export function calculateOrderModificationDeadline(
  deliveryDate: Date | string,
): DeadlineResult {
  const delivery = new Date(deliveryDate);

  // Two business days before delivery
  const lastBizBeforeDelivery = prevBusinessDay(delivery);
  const deadlineDay = prevBusinessDay(lastBizBeforeDelivery);

  // 12:00 BRT = 15:00 UTC (Brazil has no DST since 2019)
  const deadline = new Date(deadlineDay);
  deadline.setUTCHours(15, 0, 0, 0);

  const now = new Date();
  const canModify = now <= deadline;

  return {
    deadline,
    canModify,
    reason: canModify
      ? 'Dentro do prazo operacional'
      : 'Prazo para alterações expirado',
  };
}
