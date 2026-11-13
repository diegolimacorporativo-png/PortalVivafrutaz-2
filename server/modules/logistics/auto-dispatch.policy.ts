/** Small, database-independent rules shared by the auto-dispatch worker. */
export function normalizeRouteCompanyIds(value: unknown): number[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

export function routeAuthorizesCompany(routeCompanyIds: unknown, companyId: number): boolean {
  return Number.isSafeInteger(companyId) && companyId > 0 &&
    normalizeRouteCompanyIds(routeCompanyIds).includes(companyId);
}

export function routeIsEligibleForDelivery(
  route: { companyIds: unknown; deliveryDate: string | null; status: string; driverId: number },
  delivery: { companyId: number; deliveryDate: string },
): boolean {
  return routeAuthorizesCompany(route.companyIds, delivery.companyId) &&
    route.deliveryDate === delivery.deliveryDate &&
    ["SCHEDULED", "IN_PROGRESS"].includes(route.status) &&
    Number.isSafeInteger(route.driverId) && route.driverId > 0;
}

export function eligibleRoutesForDelivery<T extends {
  companyIds: unknown;
  deliveryDate: string | null;
  status: string;
  driverId: number;
}>(routes: T[], delivery: { companyId: number; deliveryDate: string }): T[] {
  return routes.filter((route) => routeIsEligibleForDelivery(route, delivery));
}

export function deliveryIsEligibleForAutoDispatch(delivery: {
  status: string;
  routeId: number | null;
  companyId: number | null;
  deliveryDate: string | null;
  hasCoordinates: boolean;
}): boolean {
  return delivery.status === "pendente" &&
    delivery.routeId == null &&
    delivery.companyId != null && Number.isSafeInteger(delivery.companyId) && delivery.companyId > 0 &&
    Boolean(delivery.deliveryDate) &&
    delivery.hasCoordinates;
}

/**
 * Append after every existing delivery in the route-wide sequence.
 * Historical position 0 is intentionally not renumbered; this function only
 * chooses positions for new assignments. A route with only legacy position 0
 * therefore receives 1 next, while the old row remains unchanged.
 */
export function nextGlobalRoutePosition(positions: Array<number | string | null>): number | null {
  const numeric = positions.map((value) => value == null ? Number.NaN : Number(value));
  if (numeric.some((position) => !Number.isSafeInteger(position))) return null;
  if (new Set(numeric).size !== numeric.length) return null;
  return numeric.length === 0 ? 1 : Math.max(...numeric) + 1;
}
