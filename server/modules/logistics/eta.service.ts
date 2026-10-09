/**
 * eta.service — pure in-memory ETA calculator for STEP 8.5.
 *
 * Reuses the existing haversine implementation from `routeOptimizer.ts`
 * (no new distance engine, no new tables, no DB writes).
 *
 * Inputs:
 *   • stops — ordered list of route stops, each with lat/lng (string or number).
 *   • driverPosition — the latest usable GPS ping. Without it, pending stops
 *     receive no ETA rather than an invented zero-distance estimate.
 *
 * Output: array of `EtaStop` enriched with `legMinutes`, `etaMinutes`
 * (cumulative from "now"), `etaTime` (ISO timestamp), and `distanceKm`.
 *
 * Tunables (kept as constants for now; can become per-route later):
 *   • AVG_SPEED_KMH    — coarse average for urban delivery routes.
 *   • STOP_DWELL_MINS  — time spent per stop after arrival (handover, etc).
 *
 * STOP_DWELL_MINS is honoured per-stop and can be overridden per-row via
 * `tempoEstimadoMin` (matches the column already on `route_stops`).
 */

import { calculateDistance, type GeoPoint } from "../../services/logistics/routeOptimizer";

export const AVG_SPEED_KMH = 40;       // matches the spec
export const STOP_DWELL_MINS = 3;      // default per-stop handover time

export interface EtaInputStop {
  id?: number | string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  /** Optional per-stop dwell time override (minutes). */
  tempoEstimadoMin?: number | null;
  /** Pre-known status — "entregue" stops still consume their leg time but
   *  contribute zero dwell time (already done). */
  status?: string | null;
  /** Set false when this row is the destination: arrival ETA excludes unloading time. */
  includeDwell?: boolean;
  /** Additional operational delay from an unresolved stop occurrence. */
  delayMinutes?: number | null;
  /** Earliest arrival time derived from the stop's local delivery window. */
  windowStartAt?: Date | string | null;
  [key: string]: any;
}

export interface EtaStop extends EtaInputStop {
  /** Distance in km from the previous waypoint (driver, then prior stop). */
  distanceKm: number | null;
  /** Driving minutes for this leg only. */
  legMinutes: number | null;
  /** Cumulative minutes from "now" until arrival at this stop. */
  etaMinutes: number | null;
  /** ISO timestamp of the predicted arrival at this stop. */
  etaTime: string | null;
}

export interface EtaSummary {
  totalDistanceKm: number;
  totalMinutes: number;
  totalEtaTime: string;
  avgSpeedKmh: number;
}

export interface EtaOptions {
  /** Current GPS speed in km/h. Invalid, stopped, or implausible values use the route average. */
  speedKmh?: number | null;
}

/**
 * Returns null if `lat`/`lng` cannot be parsed into finite numbers.
 */
function toGeo(lat: unknown, lng: unknown): GeoPoint | null {
  const a = typeof lat === "number" ? lat : parseFloat(String(lat ?? ""));
  const b = typeof lng === "number" ? lng : parseFloat(String(lng ?? ""));
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    a < -90 ||
    a > 90 ||
    b < -180 ||
    b > 180
  ) return null;
  return { lat: a, lng: b };
}

function parseWindowStart(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Calculates per-stop ETAs in cumulative minutes from "now".
 *
 * Behaviour notes:
 *   • A pending stop without parseable coordinates has null ETA metrics, and
 *     later pending stops also remain unknown because their leg is uncertain.
 *   • If `driverPosition` is missing or invalid, pending stops have null ETAs.
 *   • Stops already marked "entregue" are still emitted (UI may grey them
 *     out) but contribute 0 dwell time — they do not delay later ETAs.
 */
export function calculateETA(
  stops: EtaInputStop[],
  driverPosition?: { lat?: string | number | null; lng?: string | number | null } | null,
  now: Date = new Date(),
  options: EtaOptions = {},
): EtaStop[] {
  if (!stops || stops.length === 0) return [];

  const measuredSpeed = Number(options.speedKmh);
  const avgSpeedKmh = Number.isFinite(measuredSpeed) && measuredSpeed >= 5 && measuredSpeed <= 80
    ? measuredSpeed
    : AVG_SPEED_KMH;
  const startedAtMs = now.getTime();
  let cursor: GeoPoint | null = driverPosition
    ? toGeo(driverPosition.lat, driverPosition.lng)
    : null;
  let cumulativeMinutes = 0;
  let sequenceHasMissingCoordinates = !cursor;

  return stops.map((stop) => {
    const point = toGeo(stop.latitude, stop.longitude);

    const normalizedStatus = String(stop.status ?? "").trim().toLocaleLowerCase("pt-BR");
    const alreadyCompleted = ["entregue", "delivered", "cancelado", "cancelled"].includes(normalizedStatus);
    if (alreadyCompleted) {
      // The current GPS already represents where the driver is now. Completed
      // route stops must not add their old travel leg or dwell time again.
      return {
        ...stop,
        distanceKm: 0,
        legMinutes: 0,
        etaMinutes: Math.round(cumulativeMinutes),
        etaTime: new Date(startedAtMs + cumulativeMinutes * 60_000).toISOString(),
      };
    }

    // Do not invent zero-minute ETAs or continue through an unknown waypoint.
    if (!point || sequenceHasMissingCoordinates) {
      sequenceHasMissingCoordinates = true;
      return {
        ...stop,
        distanceKm: null,
        legMinutes: null,
        etaMinutes: null,
        etaTime: null,
      };
    }

    // The cursor is valid here because a missing driver fix blocks pending ETAs.
    let legKm = 0;
    if (cursor) {
      legKm = calculateDistance(cursor, point);
    }
    const legMinutes = (legKm / avgSpeedKmh) * 60;
    cumulativeMinutes += legMinutes;

    // Arrival is the displayed ETA. Waiting for an unopened delivery window
    // affects this stop and every following stop.
    const windowStartAt = parseWindowStart(stop.windowStartAt);
    const estimatedArrivalAt = startedAtMs + cumulativeMinutes * 60_000;
    if (windowStartAt != null && windowStartAt > estimatedArrivalAt) {
      cumulativeMinutes = (windowStartAt - startedAtMs) / 60_000;
    }
    const etaMinutes = Math.round(cumulativeMinutes);
    const etaTime = new Date(startedAtMs + cumulativeMinutes * 60_000).toISOString();

    // Service time belongs between this arrival and the next stop's ETA.
    if (stop.includeDwell !== false) {
      const dwell = typeof stop.tempoEstimadoMin === "number" && stop.tempoEstimadoMin > 0
        ? stop.tempoEstimadoMin
        : STOP_DWELL_MINS;
      const occurrenceDelay = Number(stop.delayMinutes);
      cumulativeMinutes += dwell + (
        Number.isFinite(occurrenceDelay) ? Math.max(0, occurrenceDelay) : 0
      );
    }

    cursor = point;

    return {
      ...stop,
      distanceKm: parseFloat(legKm.toFixed(3)),
      legMinutes: Math.round(legMinutes * 10) / 10,
      etaMinutes,
      etaTime,
    };
  });
}

/**
 * Aggregates per-stop results into a route-level summary.
 */
export function summariseETA(
  stops: EtaStop[],
  now: Date = new Date(),
  speedKmh?: number | null,
): EtaSummary {
  const totalDistanceKm = stops.reduce((acc, s) => acc + (s.distanceKm || 0), 0);
  const last = stops[stops.length - 1];
  const totalMinutes = last?.etaMinutes ?? 0;
  const measuredSpeed = Number(speedKmh);
  const avgSpeedKmh = Number.isFinite(measuredSpeed) && measuredSpeed >= 5 && measuredSpeed <= 80
    ? measuredSpeed
    : AVG_SPEED_KMH;
  return {
    totalDistanceKm: parseFloat(totalDistanceKm.toFixed(3)),
    totalMinutes,
    totalEtaTime: new Date(now.getTime() + totalMinutes * 60_000).toISOString(),
    avgSpeedKmh,
  };
}
