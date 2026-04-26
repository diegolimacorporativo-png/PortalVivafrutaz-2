/**
 * eta.service — pure in-memory ETA calculator for STEP 8.5.
 *
 * Reuses the existing haversine implementation from `routeOptimizer.ts`
 * (no new distance engine, no new tables, no DB writes).
 *
 * Inputs:
 *   • stops — ordered list of route stops, each with lat/lng (string or number).
 *   • driverPosition — optional latest GPS ping; when missing we start the
 *     trip from the first stop (cumulative ETA still works for sequencing).
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
  [key: string]: any;
}

export interface EtaStop extends EtaInputStop {
  /** Distance in km from the previous waypoint (driver, then prior stop). */
  distanceKm: number;
  /** Driving minutes for this leg only. */
  legMinutes: number;
  /** Cumulative minutes from "now" until arrival at this stop. */
  etaMinutes: number;
  /** ISO timestamp of the predicted arrival at this stop. */
  etaTime: string;
}

export interface EtaSummary {
  totalDistanceKm: number;
  totalMinutes: number;
  totalEtaTime: string;
  avgSpeedKmh: number;
}

/**
 * Returns null if `lat`/`lng` cannot be parsed into finite numbers.
 */
function toGeo(lat: unknown, lng: unknown): GeoPoint | null {
  const a = typeof lat === "number" ? lat : parseFloat(String(lat ?? ""));
  const b = typeof lng === "number" ? lng : parseFloat(String(lng ?? ""));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { lat: a, lng: b };
}

/**
 * Calculates per-stop ETAs in cumulative minutes from "now".
 *
 * Behaviour notes:
 *   • Stops without parseable coordinates are returned with zeroed metrics
 *     and inherit the previous cumulative ETA (so the chain doesn't break).
 *   • If `driverPosition` is null we start from the first usable stop
 *     (first leg ⇒ 0km / 0min) and accumulate from there.
 *   • Stops already marked "entregue" are still emitted (UI may grey them
 *     out) but contribute 0 dwell time — they do not delay later ETAs.
 */
export function calculateETA(
  stops: EtaInputStop[],
  driverPosition?: { lat?: string | number | null; lng?: string | number | null } | null,
  now: Date = new Date(),
): EtaStop[] {
  if (!stops || stops.length === 0) return [];

  const startedAtMs = now.getTime();
  let cursor: GeoPoint | null = driverPosition
    ? toGeo(driverPosition.lat, driverPosition.lng)
    : null;
  let cumulativeMinutes = 0;

  return stops.map((stop) => {
    const point = toGeo(stop.latitude, stop.longitude);

    // Stop without coordinates → keep ETA flat, do not advance cursor.
    if (!point) {
      return {
        ...stop,
        distanceKm: 0,
        legMinutes: 0,
        etaMinutes: Math.round(cumulativeMinutes),
        etaTime: new Date(startedAtMs + cumulativeMinutes * 60_000).toISOString(),
      };
    }

    // First useful waypoint when there's no driver fix → leg = 0.
    let legKm = 0;
    if (cursor) {
      legKm = calculateDistance(cursor, point);
    }
    const legMinutes = (legKm / AVG_SPEED_KMH) * 60;
    cumulativeMinutes += legMinutes;

    // Add dwell time for stops that haven't been delivered yet.
    if (stop.status !== "entregue") {
      const dwell = typeof stop.tempoEstimadoMin === "number" && stop.tempoEstimadoMin > 0
        ? stop.tempoEstimadoMin
        : STOP_DWELL_MINS;
      cumulativeMinutes += dwell;
    }

    cursor = point;

    return {
      ...stop,
      distanceKm: parseFloat(legKm.toFixed(3)),
      legMinutes: Math.round(legMinutes * 10) / 10,
      etaMinutes: Math.round(cumulativeMinutes),
      etaTime: new Date(startedAtMs + cumulativeMinutes * 60_000).toISOString(),
    };
  });
}

/**
 * Aggregates per-stop results into a route-level summary.
 */
export function summariseETA(stops: EtaStop[], now: Date = new Date()): EtaSummary {
  const totalDistanceKm = stops.reduce((acc, s) => acc + (s.distanceKm || 0), 0);
  const last = stops[stops.length - 1];
  const totalMinutes = last ? last.etaMinutes : 0;
  return {
    totalDistanceKm: parseFloat(totalDistanceKm.toFixed(3)),
    totalMinutes,
    totalEtaTime: new Date(now.getTime() + totalMinutes * 60_000).toISOString(),
    avgSpeedKmh: AVG_SPEED_KMH,
  };
}
