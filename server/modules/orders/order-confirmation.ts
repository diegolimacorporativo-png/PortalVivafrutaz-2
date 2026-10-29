/** Stable comparison for retrying the existing one-order-per-company/day slot. */
export function customerOrderIntentMatches(
  existingOrder: any,
  existingItems: any[],
  requestedOrder: any,
  requestedItems: any[],
): boolean {
  const stableItems = (rows: any[]) => rows
    .map((item) => [Number(item.productId), Number(item.subCategoryId ?? 0), Number(item.quantity)])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const existingDate = new Date(existingOrder.deliveryDate).toISOString().slice(0, 10);
  const requestedDate = new Date(requestedOrder.deliveryDate).toISOString().slice(0, 10);
  return existingDate === requestedDate &&
    existingOrder.weekReference === requestedOrder.weekReference &&
    Number(existingOrder.deliveryAddressId ?? 0) === Number(requestedOrder.deliveryAddressId ?? 0) &&
    (existingOrder.orderNote ?? null) === (requestedOrder.orderNote ?? null) &&
    JSON.stringify(stableItems(existingItems)) === JSON.stringify(stableItems(requestedItems));
}
