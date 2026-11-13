export interface ExistingProductCategory {
  id: number;
  categoryName: string;
  price: string | number;
  active: boolean;
}

export interface SelectedProductCategory {
  categoryName: string;
  price: string;
}

export interface ProductCategorySyncPlan {
  update: Array<{ id: number; categoryName: string; price: string; active: true }>;
  create: Array<{ categoryName: string; price: string }>;
  deactivate: number[];
}

/** Reconcile selections without deleting rows whose IDs may be referenced by order history. */
export function buildProductCategorySyncPlan(
  existing: ExistingProductCategory[],
  selected: SelectedProductCategory[],
): ProductCategorySyncPlan {
  const usedIds = new Set<number>();
  const plan: ProductCategorySyncPlan = { update: [], create: [], deactivate: [] };

  for (const selection of selected) {
    const candidate = existing
      .filter((row) => row.categoryName === selection.categoryName && !usedIds.has(row.id))
      .sort((a, b) => Number(b.active) - Number(a.active))[0];

    if (!candidate) {
      plan.create.push({ categoryName: selection.categoryName, price: String(Number(selection.price)) });
      continue;
    }

    usedIds.add(candidate.id);
    plan.update.push({
      id: candidate.id,
      categoryName: selection.categoryName,
      price: String(Number(selection.price)),
      active: true,
    });
  }

  plan.deactivate = existing
    .filter((row) => row.active && !usedIds.has(row.id))
    .map((row) => row.id);

  return plan;
}
