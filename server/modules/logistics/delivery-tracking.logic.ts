import { calculateDistance } from "../../services/logistics/routeOptimizer";
import { calculateETA } from "./eta.service";

export const TRACKING_GPS_MAX_AGE_MS = 5 * 60_000;
export const TRACKING_GPS_FUTURE_TOLERANCE_MS = 30_000;
export const TRACKING_NEARBY_DISTANCE_KM = 1.5;
export const TRACKING_ETA_MARGIN_MINUTES = 15;
export const PUBLIC_DELIVERED_RETENTION_MS = 24 * 60 * 60_000;

const SAO_PAULO_TZ = "America/Sao_Paulo";
const WEEKDAY_LABELS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

export interface DeliveryWindow {
  startTime: string;
  endTime: string;
}

export interface TrackingStop {
  id: number;
  routePosition: number | null;
  status: string | null;
  stopStatus: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  tempoEstimadoMin?: number | null;
  occurrenceStatus?: string | null;
  routeWindowStart?: string | null;
  routeWindowEnd?: string | null;
}

export interface TrackingEta {
  etaAt: Date | null;
  stopsBefore: number;
  isNextStop: boolean;
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeTrackingStatus(value: unknown): string {
  const status = normalize(value).replace(/[\s-]+/g, "_");
  if (["in_progress", "em_rota", "en_route", "in_route"].includes(status)) {
    return "in_progress";
  }
  if (["completed", "entregue", "delivered"].includes(status)) {
    return "delivered";
  }
  if (["cancelled", "canceled", "cancelado"].includes(status)) {
    return "cancelled";
  }
  return status;
}

export function isCompletedTrackingStop(stop: Pick<TrackingStop, "status" | "stopStatus">): boolean {
  return ["delivered", "cancelled"].includes(normalizeTrackingStatus(stop.status)) ||
    normalizeTrackingStatus(stop.stopStatus) === "delivered";
}

export function isFreshTrackingGps(
  recordedAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (recordedAt == null) return false;
  const timestamp = recordedAt instanceof Date
    ? recordedAt.getTime()
    : new Date(recordedAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const age = now.getTime() - timestamp;
  return age <= TRACKING_GPS_MAX_AGE_MS && age >= -TRACKING_GPS_FUTURE_TOLERANCE_MS;
}

export function getDeliveryWindow(
  deliveryConfigJson: string | null | undefined,
  deliveryDate: string | null | undefined,
): DeliveryWindow | null {
  if (!deliveryConfigJson || !deliveryDate) return null;

  let config: Record<string, any>;
  try {
    const parsed = JSON.parse(deliveryConfigJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    config = parsed;
  } catch {
    return null;
  }

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(deliveryDate);
  if (!dateMatch) return null;
  const date = new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), 12));
  const weekday = WEEKDAY_LABELS[date.getUTCDay()];
  const dayConfig = Object.entries(config).find(([key]) => normalize(key) === normalize(weekday))?.[1];
  if (!dayConfig || dayConfig.enabled !== true) return null;

  const startTime = normalizeTime(dayConfig.startTime);
  const endTime = normalizeTime(dayConfig.endTime);
  if (!startTime || !endTime || timeToMinutes(endTime) <= timeToMinutes(startTime)) return null;
  return { startTime, endTime };
}

export function getEffectiveDeliveryWindow(
  deliveryConfigJson: string | null | undefined,
  deliveryDate: string | null | undefined,
  routeWindowStart?: string | null,
  routeWindowEnd?: string | null,
): DeliveryWindow | null {
  const routeStart = normalizeTime(routeWindowStart);
  const routeEnd = normalizeTime(routeWindowEnd);
  if (
    routeStart &&
    routeEnd &&
    timeToMinutes(routeEnd) > timeToMinutes(routeStart)
  ) {
    return { startTime: routeStart, endTime: routeEnd };
  }
  return getDeliveryWindow(deliveryConfigJson, deliveryDate);
}

function normalizeTime(value: unknown): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? "").trim());
  return match ? `${match[1]}:${match[2]}` : null;
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function localDateTimeToInstant(date: string, time: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const normalizedTime = normalizeTime(time);
  if (!match || !normalizedTime) return null;

  const [hour, minute] = normalizedTime.split(":").map(Number);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const offsetLabel = new Intl.DateTimeFormat("en", {
    timeZone: SAO_PAULO_TZ,
    timeZoneName: "shortOffset",
  }).formatToParts(noon).find((part) => part.type === "timeZoneName")?.value;
  const offsetMatch = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(offsetLabel ?? "");
  if (!offsetMatch) return null;

  const sign = offsetMatch[1] === "-" ? -1 : 1;
  const offsetMinutes = sign * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3] ?? 0));
  return new Date(localAsUtc - offsetMinutes * 60_000);
}

export function calculateTrackingEta(
  routeStops: TrackingStop[],
  targetDeliveryId: number,
  driverPosition: { lat: string | number; lng: string | number },
  now: Date = new Date(),
  speedKmh?: number | null,
): TrackingEta {
  const ordered = [...routeStops].sort((a, b) =>
    (a.routePosition ?? Number.MAX_SAFE_INTEGER) - (b.routePosition ?? Number.MAX_SAFE_INTEGER) ||
    a.id - b.id,
  );
  const targetIndex = ordered.findIndex((stop) => Number(stop.id) === targetDeliveryId);
  if (targetIndex < 0) return { etaAt: null, stopsBefore: 0, isNextStop: false };

  const target = ordered[targetIndex];
  const stopsBefore = ordered
    .slice(0, targetIndex)
    .filter((stop) => !isCompletedTrackingStop(stop))
    .length;

  const activeStops = ordered
    .filter((stop) => !isCompletedTrackingStop(stop) || Number(stop.id) === targetDeliveryId)
    .map((stop) => ({
      id: stop.id,
      latitude: stop.latitude,
      longitude: stop.longitude,
      status: Number(stop.id) === targetDeliveryId ? null : stop.status,
      tempoEstimadoMin: stop.tempoEstimadoMin,
      delayMinutes: occurrenceDelayMinutes(stop.occurrenceStatus),
      includeDwell: Number(stop.id) !== targetDeliveryId,
    }));
  const estimates = calculateETA(activeStops, driverPosition, now, { speedKmh });
  const estimate = estimates.find((stop) => Number(stop.id) === targetDeliveryId);
  if (!estimate || !Number.isFinite(new Date(estimate.etaTime).getTime())) {
    return { etaAt: null, stopsBefore, isNextStop: stopsBefore === 0 };
  }

  return {
    etaAt: new Date(estimate.etaTime),
    stopsBefore,
    isNextStop: stopsBefore === 0,
  };
}

const OCCURRENCE_DELAY_MINUTES: Record<string, number> = {
  cliente_ausente: 15,
  endereco_incorreto: 10,
  recusado: 15,
  reagendado: 5,
  problema: 20,
  vehicle_problem: 20,
  traffic: 10,
  transito: 10,
  atraso: 10,
  espera_portaria: 10,
};

function occurrenceDelayMinutes(value: unknown): number {
  return OCCURRENCE_DELAY_MINUTES[normalizeTrackingStatus(value)] ?? 0;
}

export function isDriverNearby(
  driverPosition: { lat: string | number; lng: string | number } | null | undefined,
  deliveryPosition: { lat: string | number; lng: string | number } | null | undefined,
): boolean {
  if (!driverPosition || !deliveryPosition) return false;
  const lat1 = Number(driverPosition.lat);
  const lng1 = Number(driverPosition.lng);
  const lat2 = Number(deliveryPosition.lat);
  const lng2 = Number(deliveryPosition.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return false;
  return calculateDistance({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 }) <= TRACKING_NEARBY_DISTANCE_KM;
}

export function makeEtaRange(
  etaAt: Date | null,
  marginMinutes: number = TRACKING_ETA_MARGIN_MINUTES,
  earliestAt?: Date | null,
): { from: string; to: string } | null {
  if (!etaAt || !Number.isFinite(etaAt.getTime())) return null;
  const interval = 5 * 60_000;
  const margin = Math.max(0, marginMinutes) * 60_000;
  const minimum = earliestAt && Number.isFinite(earliestAt.getTime())
    ? earliestAt.getTime()
    : Number.NEGATIVE_INFINITY;
  const adjustedEta = Math.max(etaAt.getTime(), minimum);
  const from = Math.max(
    Math.floor((adjustedEta - margin) / interval) * interval,
    Math.ceil(minimum / interval) * interval,
  );
  const to = Math.max(
    Math.ceil((adjustedEta + margin) / interval) * interval,
    from,
  );
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export function calculateTrackingDelay(
  etaAt: Date | null,
  windowEnd: Date | null,
  now: Date = new Date(),
): { delayed: boolean; delayMinutes: number } {
  if (!windowEnd || !Number.isFinite(windowEnd.getTime())) {
    return { delayed: false, delayMinutes: 0 };
  }
  const expectedAt = etaAt && Number.isFinite(etaAt.getTime())
    ? Math.max(now.getTime(), etaAt.getTime())
    : now.getTime();
  const delayMs = expectedAt - windowEnd.getTime();
  if (delayMs <= 0) return { delayed: false, delayMinutes: 0 };
  const windowOverrunMs = now.getTime() - windowEnd.getTime();
  return {
    delayed: true,
    delayMinutes: windowOverrunMs > 0
      ? Math.max(1, Math.ceil(windowOverrunMs / 60_000))
      : 0,
  };
}
