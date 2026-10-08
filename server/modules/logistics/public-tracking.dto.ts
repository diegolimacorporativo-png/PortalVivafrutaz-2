export interface PublicDeliveryTrackingInput {
  status: string;
  deliveryStatus: string;
  trackingAvailable: boolean;
  scheduledDate: string | null;
  deliveryWindow: { startTime: string; endTime: string } | null;
  deliveredAt: Date | string | null;
  lastUpdatedAt: Date | string | null;
  etaRange: { from: string; to: string } | null;
  stopsBefore: number | null;
  isNextStop: boolean;
  isDriverNearby: boolean;
  delayed: boolean;
  delayMinutes: number;
  message: string;
  deliveryLocation: {
    latitude: unknown;
    longitude: unknown;
  } | null;
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
    deliveryStatus: input.deliveryStatus,
    trackingAvailable: input.trackingAvailable,
    scheduledDate: input.scheduledDate,
    deliveryWindow: input.deliveryWindow,
    deliveredAt: publicTimestamp(input.deliveredAt),
    lastUpdatedAt: publicTimestamp(input.lastUpdatedAt),
    etaRange: input.etaRange,
    stopsBefore: input.stopsBefore,
    isNextStop: input.isNextStop,
    isDriverNearby: input.isDriverNearby,
    delayed: input.delayed,
    delayMinutes: input.delayMinutes,
    message: input.message,
    deliveryLocation: input.deliveryLocation
      ? {
          // This point belongs only to the delivery represented by this
          // capability, so retain enough precision for its own destination.
          lat: Number.isFinite(Number(input.deliveryLocation.latitude))
            ? String(input.deliveryLocation.latitude)
            : null,
          lng: Number.isFinite(Number(input.deliveryLocation.longitude))
            ? String(input.deliveryLocation.longitude)
            : null,
        }
      : null,
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
      status: input.route.status,
      deliveryDate: input.route.deliveryDate,
    },
    driver: null,
    stops: [],
    deliveries: [],
    driverPosition: null,
    viewerScope: "public" as const,
  };
}