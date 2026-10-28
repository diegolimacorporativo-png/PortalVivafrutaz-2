import { createHash } from "node:crypto";

export interface RoadWaypoint {
  latitude: string | number | null | undefined;
  longitude: string | number | null | undefined;
}

export interface RoadLeg {
  distanceKm: number;
  durationSeconds: number;
}

export interface RoadRoute {
  distanceKm: number;
  durationSeconds: number;
  legs: RoadLeg[];
  provider: "osrm_openstreetmap";
}

export interface RoadEtaStop extends RoadWaypoint {
  status?: string | null;
  includeDwell?: boolean;
  tempoEstimadoMin?: number | null;
  delayMinutes?: number | null;
  windowStartAt?: Date | string | null;
}

export interface RoadEtaStopResult<T extends RoadEtaStop> extends RoadEtaStop {
  source: T;
  distanceKm: number | null;
  legMinutes: number | null;
  etaMinutes: number | null;
  etaTime: string | null;
}

export interface RoadEtaResult<T extends RoadEtaStop> {
  stops: RoadEtaStopResult<T>[];
  summary: {
    totalDistanceKm: number;
    totalMinutes: number;
    totalEtaTime: string;
    avgSpeedKmh: number;
  };
  provider: "osrm_openstreetmap";
}

const ROUTING_URL_ENV = "OSRM_ROUTING_URL";
const MAX_INTERMEDIATE_STOPS = 25;
const ROUTE_CACHE_TTL_MS = 30_000;
const DEFAULT_STOP_DWELL_MINUTES = 3;
const routeCache = new Map<string, { expiresAt: number; route: RoadRoute }>();

function getRoutingBaseUrl(): string | null {
  const configured = process.env[ROUTING_URL_ENV]?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function isRoadRoutingConfigured(): boolean {
  return getRoutingBaseUrl() !== null;
}

function parseCoordinate(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function normalizedPoints(points: RoadWaypoint[]): Array<{ latitude: number; longitude: number }> | null {
  const parsed = points.map((point) => {
    const latitude = parseCoordinate(point.latitude, -90, 90);
    const longitude = parseCoordinate(point.longitude, -180, 180);
    return latitude == null || longitude == null ? null : { latitude, longitude };
  });
  return parsed.some((point) => point == null)
    ? null
    : parsed as Array<{ latitude: number; longitude: number }>;
}

function routeCacheKey(points: Array<{ latitude: number; longitude: number }>): string {
  // Coarsen only the short-lived cache key. Exact driver and stop coordinates
  // are sent to the configured routing service, but never written to logs.
  const rounded = points.map(({ latitude, longitude }) => [
    latitude.toFixed(3),
    longitude.toFixed(3),
  ]);
  return createHash("sha256").update(JSON.stringify(rounded)).digest("hex");
}

function cleanExpiredCache(now: number): void {
  for (const [key, value] of routeCache) {
    if (value.expiresAt <= now) routeCache.delete(key);
  }
}

/**
 * Road-network distance and profile-based duration from a configured OSRM
 * service. OSRM does not provide live traffic; no straight-line fallback is
 * returned when the service is unavailable.
 */
export async function computeRoadRoute(
  waypoints: RoadWaypoint[],
  now: Date = new Date(),
): Promise<RoadRoute | null> {
  const baseUrl = getRoutingBaseUrl();
  if (!baseUrl || waypoints.length < 2 || waypoints.length - 2 > MAX_INTERMEDIATE_STOPS) {
    return null;
  }

  const points = normalizedPoints(waypoints);
  if (!points) return null;
  const cacheKey = routeCacheKey(points);
  cleanExpiredCache(now.getTime());
  const cached = routeCache.get(cacheKey);
  if (cached && cached.expiresAt > now.getTime()) return cached.route;

  const coordinates = points
    .map(({ latitude, longitude }) => `${longitude.toFixed(6)},${latitude.toFixed(6)}`)
    .join(";");
  const routeUrl = `${baseUrl}/route/v1/driving/${coordinates}?overview=false&steps=false&alternatives=false`;

  try {
    const response = await fetch(routeUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      console.warn(`[ROAD_ROUTING_UNAVAILABLE] provider_status=${response.status}`);
      return null;
    }

    const payload = await response.json() as {
      code?: string;
      routes?: Array<{
        duration?: unknown;
        distance?: unknown;
        legs?: Array<{ duration?: unknown; distance?: unknown }>;
      }>;
    };
    const route = payload.routes?.[0];
    const durationSeconds = Number(route?.duration);
    const distanceMeters = Number(route?.distance);
    const legs = route?.legs?.map((leg) => {
      const legDuration = Number(leg.duration);
      const legDistance = Number(leg.distance);
      if (!Number.isFinite(legDuration) || legDuration < 0 || !Number.isFinite(legDistance) || legDistance < 0) return null;
      return { durationSeconds: legDuration, distanceKm: legDistance / 1000 };
    });
    if (
      payload.code !== "Ok" ||
      !Number.isFinite(durationSeconds) || durationSeconds < 0 ||
      !Number.isFinite(distanceMeters) || distanceMeters < 0 ||
      !legs || legs.length !== points.length - 1 || legs.some((leg) => leg == null)
    ) {
      console.warn("[ROAD_ROUTING_UNAVAILABLE] provider_response_invalid=true");
      return null;
    }

    const result: RoadRoute = {
      durationSeconds,
      distanceKm: distanceMeters / 1000,
      legs: legs as RoadLeg[],
      provider: "osrm_openstreetmap",
    };
    routeCache.set(cacheKey, { expiresAt: now.getTime() + ROUTE_CACHE_TTL_MS, route: result });
    return result;
  } catch {
    // Never log request coordinates or provider data. The live GPS remains
    // available; only the road-based ETA is suppressed.
    console.warn("[ROAD_ROUTING_UNAVAILABLE] request_failed=true");
    return null;
  }
}

function parseTimestamp(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function completed(stop: RoadEtaStop): boolean {
  const status = String(stop.status ?? "").trim().toLocaleLowerCase("pt-BR");
  return ["entregue", "delivered", "cancelado", "cancelled", "canceled"].includes(status);
}

/** Calculates arrival times from OSRM road legs, windows and dwell time. */
export async function calculateRoadEta<T extends RoadEtaStop>(
  stops: T[],
  origin: RoadWaypoint,
  now: Date = new Date(),
): Promise<RoadEtaResult<T> | null> {
  if (!stops.length) return null;
  const activeStops = stops.filter((stop) => !completed(stop));
  if (!activeStops.length) {
    const etaTime = now.toISOString();
    return {
      stops: stops.map((stop) => ({ source: stop, ...stop, distanceKm: 0, legMinutes: 0, etaMinutes: 0, etaTime })),
      summary: { totalDistanceKm: 0, totalMinutes: 0, totalEtaTime: etaTime, avgSpeedKmh: 0 },
      provider: "osrm_openstreetmap",
    };
  }
  const route = await computeRoadRoute([origin, ...activeStops], now);
  if (!route) return null;

  let elapsedMinutes = 0;
  let activeIndex = 0;
  const etaByStop = new Map<T, RoadEtaStopResult<T>>();
  for (const stop of stops) {
    if (completed(stop)) {
      etaByStop.set(stop, {
        source: stop, ...stop, distanceKm: 0, legMinutes: 0,
        etaMinutes: Math.round(elapsedMinutes),
        etaTime: new Date(now.getTime() + elapsedMinutes * 60_000).toISOString(),
      });
      continue;
    }

    const leg = route.legs[activeIndex];
    if (!leg) return null;
    elapsedMinutes += leg.durationSeconds / 60;
    const windowStart = parseTimestamp(stop.windowStartAt);
    const arrivalMs = now.getTime() + elapsedMinutes * 60_000;
    if (windowStart != null && windowStart > arrivalMs) {
      elapsedMinutes = (windowStart - now.getTime()) / 60_000;
    }
    etaByStop.set(stop, {
      source: stop, ...stop,
      distanceKm: leg.distanceKm,
      legMinutes: Math.round((leg.durationSeconds / 60) * 10) / 10,
      etaMinutes: Math.round(elapsedMinutes),
      etaTime: new Date(now.getTime() + elapsedMinutes * 60_000).toISOString(),
    });
    if (stop.includeDwell !== false) {
      const dwellMinutes = typeof stop.tempoEstimadoMin === "number" && stop.tempoEstimadoMin > 0
        ? stop.tempoEstimadoMin
        : DEFAULT_STOP_DWELL_MINUTES;
      const delayMinutes = Number(stop.delayMinutes);
      elapsedMinutes += dwellMinutes + (Number.isFinite(delayMinutes) ? Math.max(0, delayMinutes) : 0);
    }
    activeIndex++;
  }

  const results = stops.map((stop) => etaByStop.get(stop)!).filter(Boolean);
  const finalEta = results.at(-1)?.etaTime ?? now.toISOString();
  const finalMinutes = Math.max(0, (new Date(finalEta).getTime() - now.getTime()) / 60_000);
  const drivingMinutes = route.durationSeconds / 60;
  return {
    stops: results,
    summary: {
      totalDistanceKm: route.distanceKm,
      totalMinutes: Math.round(finalMinutes),
      totalEtaTime: finalEta,
      avgSpeedKmh: drivingMinutes > 0 ? Math.round((route.distanceKm / drivingMinutes) * 60 * 10) / 10 : 0,
    },
    provider: route.provider,
  };
}