import { normalizeRouteCompanyIds } from "./auto-dispatch.policy";

export interface DriverRouteScope {
  id: number;
  driverId: number;
  deliveryDate: string | null;
  status: string;
  companyIds: unknown;
}

export interface DriverRouteDeliveryScope {
  id: number;
  routeId: number | null;
  driverId: number | null;
  companyId: number | null;
  deliveryDate: string | null;
  status: string;
  routePosition: number | null;
}

/** A driver sees a delivery only through their own route and its explicit company scope. */
export function isDeliveryVisibleOnDriverRoute(
  route: DriverRouteScope,
  delivery: DriverRouteDeliveryScope,
  authenticatedDriverId: number,
): boolean {
  const allowedCompanies = new Set(normalizeRouteCompanyIds(route.companyIds));
  const normalizedRouteStatus = route.status.toUpperCase();
  const normalizedDeliveryStatus = delivery.status.toLowerCase();
  return route.id > 0 && route.driverId === authenticatedDriverId &&
    normalizedRouteStatus !== "CANCELLED" &&
    delivery.routeId === route.id &&
    (delivery.driverId == null || delivery.driverId === route.driverId) &&
    delivery.companyId != null && allowedCompanies.has(delivery.companyId) &&
    Boolean(route.deliveryDate && delivery.deliveryDate === route.deliveryDate) &&
    !["cancelado", "cancelled", "canceled"].includes(normalizedDeliveryStatus);
}

export function sortDriverRouteDeliveries<T extends { routePosition: number | null; id: number }>(
  deliveries: T[],
): T[] {
  return [...deliveries].sort((left, right) =>
    (left.routePosition ?? Number.MAX_SAFE_INTEGER) - (right.routePosition ?? Number.MAX_SAFE_INTEGER) ||
    left.id - right.id,
  );
}

/** Empty routes are not considered completed; every linked stop must be terminal. */
export function areAllRouteDeliveriesTerminal(deliveries: Array<{ status: string }>): boolean {
  const terminal = new Set(["entregue", "cancelado", "cancelled", "canceled"]);
  return deliveries.length > 0 && deliveries.every((delivery) =>
    terminal.has(String(delivery.status ?? "").trim().toLowerCase()),
  );
}
