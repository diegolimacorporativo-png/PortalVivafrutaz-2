export interface WeeklyBillingOrder {
  id?: number;
  companyId?: number | string | null;
  weekReference?: string | null;
  status?: string | null;
  totalValue?: number | string | null;
}

export interface WeeklyBillingInput {
  companyId: number;
  weekReference?: string | null;
  existingOrders: WeeklyBillingOrder[];
  candidateItems: Array<{
    unitPrice?: number | string | null;
    quantity?: number | string | null;
  }>;
  replacingOrderId?: number;
}

/**
 * Recalculates the value represented by items from their unit prices.
 * Client-supplied order totals are intentionally not used.
 */
export function calculateItemsTotal(
  items: WeeklyBillingInput["candidateItems"],
): number {
  return items.reduce((total, item) => {
    const unitPrice = Number(item.unitPrice ?? 0);
    const quantity = Number(item.quantity ?? 0);
    return total + (Number.isFinite(unitPrice) ? unitPrice : 0) * (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
}

/**
 * Calculates the applicable weekly billing total.
 *
 * `existingOrders` is expected to come from the tenant-scoped repository.
 * The company filter remains explicit here as defense in depth so a row from
 * another tenant can never contribute to the minimum calculation.
 */
export function calculateWeeklyBillingTotal(input: WeeklyBillingInput): number {
  const persistedTotal = input.existingOrders
    .filter((order) => {
      if (order.companyId == null || Number(order.companyId) !== Number(input.companyId)) {
        return false;
      }
      if (order.status === "CANCELLED") return false;
      if (
        input.weekReference != null &&
        String(order.weekReference ?? "") !== String(input.weekReference)
      ) {
        return false;
      }
      return input.replacingOrderId == null || Number(order.id) !== Number(input.replacingOrderId);
    })
    .reduce((total, order) => {
      const value = Number(order.totalValue ?? 0);
      return total + (Number.isFinite(value) ? value : 0);
    }, 0);

  return persistedTotal + calculateItemsTotal(input.candidateItems);
}

export function minimumWeeklyBillingMessage(minimum: number, total: number): string {
  const fmt = (value: number) =>
    value.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return `A programação da semana não atingiu o faturamento mínimo de R$ ${fmt(minimum)}. Total calculado: R$ ${fmt(total)}.`;
}