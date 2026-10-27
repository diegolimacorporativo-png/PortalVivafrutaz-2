export type WeightedAverageInput = {
  unit: string;
  quantity: number;
  frequency: number;
  unitPrice: number;
  avgCost: number;
};

export type WeightedAverage = {
  unit: string;
  productCount: number;
  weeklyQuantity: number;
  averageUnitPrice: number;
  averageUnitCost: number;
};

/** Calculates weighted unit price and cost without combining unlike units. */
export function calculateWeightedAverages(items: WeightedAverageInput[]): WeightedAverage[] {
  const groups = new Map<string, {
    weightedQuantity: number;
    weightedPrice: number;
    weightedCost: number;
    productCount: number;
  }>();

  for (const item of items) {
    const quantity = item.quantity * item.frequency;
    if (!item.unit || !Number.isFinite(quantity) || quantity <= 0) continue;
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0 || !Number.isFinite(item.avgCost) || item.avgCost < 0) continue;

    const group = groups.get(item.unit) ?? {
      weightedQuantity: 0,
      weightedPrice: 0,
      weightedCost: 0,
      productCount: 0,
    };
    group.weightedQuantity += quantity;
    group.weightedPrice += item.unitPrice * quantity;
    group.weightedCost += item.avgCost * quantity;
    group.productCount += 1;
    groups.set(item.unit, group);
  }

  return [...groups.entries()].map(([unit, group]) => ({
    unit,
    productCount: group.productCount,
    weeklyQuantity: group.weightedQuantity,
    averageUnitPrice: group.weightedPrice / group.weightedQuantity,
    averageUnitCost: group.weightedCost / group.weightedQuantity,
  }));
}
