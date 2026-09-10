export interface PublicDeliveryTrackingInput {
  status: string;
  scheduledDate: string | null;
  deliveredAt: Date | string | null;
  routePosition: number | null;
  totalStopsInRoute: number;
  stopsAhead: number;
  etaMinutes: number;
  etaTime: string;
  driverPosition: {
    latitude: unknown;
    longitude: unknown;
    recordedAt: Date | string;
  } | null;
}

export interface PublicRouteTrackingInput {
  route: {
    name: string | null;
    status: string;
    deliveryDate: string | null;
  };
  stops: Array<{
    ordem: number | null;
    cidade: string | null;
    estado: string | null;
    latitude: unknown;
    longitude: unknown;
    status?: string | null;
  }>;
  deliveries: Array<{
    status: string;
    routePosition: number | null;
    latitude: unknown;
    longitude: unknown;
    scheduledDate: string | null;
    deliveredAt: Date | string | null;
  }>;
  driverPosition: {
    lat: unknown;
    lng: unknown;
    recordedAt: Date | string;
  } | null;
}

function publicCoordinate(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  // Approximately kilometre-level precision; the stored GPS value is never
  // changed, only the anonymous response is rounded.
  return numeric.toFixed(2);
}

function publicTimestamp(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function buildPublicDeliveryTrackingPayload(
  input: PublicDeliveryTrackingInput,
) {
  return {
    status: input.status,
    scheduledDate: input.scheduledDate,
    deliveredAt: publicTimestamp(input.deliveredAt),
    routePosition: input.routePosition,
    totalStopsInRoute: input.totalStopsInRoute,
    stopsAhead: input.stopsAhead,
    etaMinutes: input.etaMinutes,
    etaTime: input.etaTime,
    driverPosition: input.driverPosition
      ? {
          lat: publicCoordinate(input.driverPosition.latitude),
          lng: publicCoordinate(input.driverPosition.longitude),
          updatedAt: publicTimestamp(input.driverPosition.recordedAt),
        }
      : null,
  };
}

export function buildPublicRouteTrackingPayload(
  input: PublicRouteTrackingInput,
) {
  return {
    route: {
      name: input.route.name,
      status: input.route.status,
      deliveryDate: input.route.deliveryDate,
    },
    // A public viewer can see that a driver is active, but not identify or
    // contact the driver.
    driver: null,
    stops: input.stops.map((stop) => ({
      ordem: stop.ordem,
      cidade: stop.cidade,
      estado: stop.estado,
      latitude: publicCoordinate(stop.latitude),
      longitude: publicCoordinate(stop.longitude),
      status: stop.status ?? null,
    })),
    deliveries: input.deliveries.map((delivery) => ({
      status: delivery.status,
      routePosition: delivery.routePosition,
      latitude: publicCoordinate(delivery.latitude),
      longitude: publicCoordinate(delivery.longitude),
      scheduledDate: delivery.scheduledDate,
      deliveredAt: publicTimestamp(delivery.deliveredAt),
    })),
    driverPosition: input.driverPosition
      ? {
          lat: publicCoordinate(input.driverPosition.lat),
          lng: publicCoordinate(input.driverPosition.lng),
          updatedAt: publicTimestamp(input.driverPosition.recordedAt),
        }
      : null,
    viewerScope: "public" as const,
  };
}