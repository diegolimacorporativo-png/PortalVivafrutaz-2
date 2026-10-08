import { sql } from "drizzle-orm";
import { calculateDistance } from "../../services/logistics/routeOptimizer";
import {
  calculateTrackingEta,
  calculateTrackingDelay,
  getDeliveryWindow,
  getEffectiveDeliveryWindow,
  isDriverNearby,
  isFreshTrackingGps,
  localDateTimeToInstant,
  makeEtaRange,
  normalizeTrackingStatus,
  PUBLIC_DELIVERED_RETENTION_MS,
  type TrackingStop,
} from "./delivery-tracking.logic";
import { buildPublicDeliveryTrackingPayload } from "./public-tracking.dto";

type DbRow = Record<string, any>;
type TrackingDatabase = {
  execute(query: unknown): Promise<unknown>;
};

async function getTrackingDatabase(database?: TrackingDatabase): Promise<TrackingDatabase> {
  if (database) return database;
  const { db } = await import("../../database/db");
  return db as unknown as TrackingDatabase;
}

function rowsOf<T extends DbRow = DbRow>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const valueAsString = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(valueAsString) ? valueAsString.slice(0, 10) : null;
}

function publicDeliveryStatus(status: unknown): "scheduled" | "in_transit" | "delivered" | "cancelled" {
  const normalized = normalizeTrackingStatus(status);
  if (normalized === "delivered") return "delivered";
  if (normalized === "cancelled") return "cancelled";
  if (normalized === "in_progress") return "in_transit";
  return "scheduled";
}

function buildScheduledPayload(input: {
  status?: string | null;
  deliveryStatus?: string | null;
  scheduledDate: string | null;
  deliveryConfigJson?: string | null;
  latitude?: unknown;
  longitude?: unknown;
  deliveredAt?: Date | string | null;
  updatedAt?: Date | string | null;
}, now: Date) {
  const deliveryStatus = publicDeliveryStatus(input.deliveryStatus ?? input.status);
  const window = getDeliveryWindow(input.deliveryConfigJson, input.scheduledDate);
  const windowEnd = window && input.scheduledDate
    ? localDateTimeToInstant(input.scheduledDate, window.endTime)
    : null;
  const delay = calculateTrackingDelay(null, windowEnd, now);
  const delayed = deliveryStatus !== "delivered" &&
    deliveryStatus !== "cancelled" &&
    delay.delayed;
  const delayMinutes = delayed ? delay.delayMinutes : 0;

  return buildPublicDeliveryTrackingPayload({
    status: deliveryStatus,
    deliveryStatus,
    trackingAvailable: false,
    scheduledDate: input.scheduledDate,
    deliveryWindow: window,
    deliveredAt: input.deliveredAt ?? null,
    lastUpdatedAt: input.updatedAt ?? null,
    etaRange: null,
    stopsBefore: null,
    isNextStop: false,
    isDriverNearby: false,
    delayed,
    delayMinutes,
    message: deliveryStatus === "cancelled"
      ? "Este pedido foi cancelado."
      : deliveryStatus === "delivered"
        ? "Sua entrega foi concluída."
        : delayed
          ? "A janela prevista terminou. A equipe está atualizando a previsão."
          : "Entrega programada. A localização do motorista ficará disponível quando a rota iniciar.",
    deliveryLocation: {
      latitude: input.latitude,
      longitude: input.longitude,
    },
    driverPosition: null,
  });
}

async function getDeliveryTracking(
  deliveryId: number,
  now: Date,
  expectedCompanyId: number | undefined,
  database: TrackingDatabase,
) {
  const baseRows = rowsOf(await database.execute(sql`
    SELECT d.id,
           d.order_id,
           d.company_id,
           d.driver_id,
           d.route_id,
           d.status AS delivery_status,
           d.scheduled_date::text AS scheduled_date,
           d.delivered_at,
           d.route_position,
           d.stop_status,
           d.stop_status_at,
           d.latitude::text AS delivery_latitude,
           d.longitude::text AS delivery_longitude,
           d.updated_at,
           o.company_id AS order_company_id,
           o.status AS order_status,
           o.delivery_date::text AS order_delivery_date,
           c.delivery_config_json,
           c.latitude::text AS company_latitude,
           c.longitude::text AS company_longitude,
           r.empresa_id AS route_company_id,
           r.driver_id AS route_driver_id,
           r.status AS route_status,
           r.start_time AS route_start_time,
           EXISTS (
             SELECT 1
             FROM route_stops official_stops
             WHERE official_stops.route_id = d.route_id
           ) AS route_has_stops,
           ld.empresa_id AS driver_company_id
    FROM deliveries d
    LEFT JOIN orders o ON o.id = d.order_id
    LEFT JOIN companies c ON c.id = COALESCE(d.company_id, o.company_id)
    LEFT JOIN logistics_routes r ON r.id = d.route_id
    LEFT JOIN logistics_drivers ld ON ld.id = COALESCE(d.driver_id, r.driver_id)
    WHERE d.id = ${deliveryId}
    LIMIT 1
  `));
  const delivery = baseRows[0];
  if (!delivery) return null;

  const companyId = Number(delivery.company_id ?? delivery.order_company_id);
  if (!Number.isInteger(companyId) || companyId <= 0) return null;
  if (expectedCompanyId != null && companyId !== expectedCompanyId) return null;
  if (
    delivery.company_id != null &&
    delivery.order_company_id != null &&
    Number(delivery.company_id) !== Number(delivery.order_company_id)
  ) return null;

  const scheduledDate = dateOnly(delivery.scheduled_date ?? delivery.order_delivery_date);
  const deliveryLocation = {
    latitude: delivery.delivery_latitude ?? delivery.company_latitude,
    longitude: delivery.delivery_longitude ?? delivery.company_longitude,
  };
  const effectiveDeliveryStatus =
    String(delivery.order_status ?? "").toUpperCase() === "CANCELLED"
      ? "cancelled"
      : String(delivery.order_status ?? "").toUpperCase() === "DELIVERED"
        ? "delivered"
        : delivery.delivery_status;
  const status = normalizeTrackingStatus(effectiveDeliveryStatus);
  if (status === "cancelled") {
    return buildScheduledPayload({
      deliveryStatus: "cancelled",
      scheduledDate,
      deliveryConfigJson: delivery.delivery_config_json,
      ...deliveryLocation,
      deliveredAt: delivery.delivered_at,
      updatedAt: delivery.updated_at,
    }, now);
  }

  if (status === "delivered") {
    return buildScheduledPayload({
      deliveryStatus: "delivered",
      scheduledDate,
      deliveryConfigJson: delivery.delivery_config_json,
      ...deliveryLocation,
      deliveredAt: delivery.delivered_at,
      updatedAt: delivery.updated_at,
    }, now);
  }

  const basePayload = buildScheduledPayload({
      deliveryStatus: effectiveDeliveryStatus,
    scheduledDate,
    deliveryConfigJson: delivery.delivery_config_json,
    ...deliveryLocation,
    deliveredAt: delivery.delivered_at,
    updatedAt: delivery.updated_at,
  }, now);

  const routeId = Number(delivery.route_id);
  const driverId = Number(delivery.driver_id ?? delivery.route_driver_id);
  const routeCompanyId = Number(delivery.route_company_id);
  const driverCompanyId = Number(delivery.driver_company_id);
  const consistentRoute =
    Number.isInteger(routeId) && routeId > 0 &&
    routeCompanyId === companyId &&
    (delivery.driver_id == null || delivery.route_driver_id == null ||
      Number(delivery.driver_id) === Number(delivery.route_driver_id)) &&
    (delivery.driver_id == null || driverCompanyId === companyId) &&
    (delivery.route_driver_id == null || driverCompanyId === companyId);

  // A public delivery capability is no longer useful after route unlinking.
  // The authenticated order page still receives the safe scheduled state.
  if (!consistentRoute || !Number.isInteger(driverId) || driverId <= 0) {
    return basePayload;
  }

  const routeActive = normalizeTrackingStatus(delivery.route_status) === "in_progress";
  if (!routeActive) return basePayload;

  const journeyRows = rowsOf(await database.execute(sql`
    SELECT id, started_at
    FROM driver_journeys
    WHERE driver_id = ${driverId}
      AND status = 'active'
      AND (empresa_id = ${companyId} OR empresa_id IS NULL)
    ORDER BY started_at DESC
    LIMIT 1
  `));
  if (journeyRows.length === 0) return basePayload;
  const journeyStartedAtMs = new Date(journeyRows[0].started_at).getTime();
  if (!Number.isFinite(journeyStartedAtMs)) return basePayload;

  const gpsRows = rowsOf(await database.execute(sql`
    SELECT latitude::text AS latitude,
           longitude::text AS longitude,
           speed::text AS speed,
           recorded_at
    FROM driver_gps_positions
    WHERE driver_id = ${driverId}
    ORDER BY recorded_at DESC
    LIMIT 1
  `));
  const gps = gpsRows[0];
  if (
    !gps ||
    !isFreshTrackingGps(gps.recorded_at, now) ||
    !Number.isFinite(new Date(gps.recorded_at).getTime()) ||
    new Date(gps.recorded_at).getTime() < journeyStartedAtMs ||
    !Number.isFinite(Number(gps.latitude)) ||
    !Number.isFinite(Number(gps.longitude))
  ) return basePayload;

  const routeStopRows = rowsOf<DbRow>(await database.execute(sql`
    SELECT id,
           company_id,
           ordem_parada,
           latitude::text AS latitude,
           longitude::text AS longitude,
           janela_inicio,
           janela_fim,
           tempo_estimado_min
    FROM route_stops
    WHERE route_id = ${routeId}
      AND company_id = ${companyId}
    ORDER BY ordem_parada ASC NULLS LAST, id ASC
  `));
  const hasOfficialRouteStops =
    delivery.route_has_stops === true ||
    delivery.route_has_stops === "true" ||
    delivery.route_has_stops === "t" ||
    routeStopRows.length > 0;
  if (hasOfficialRouteStops && routeStopRows.length === 0) return basePayload;
  const routeStopsWithPosition: Array<DbRow & {
    sequencePosition: number;
    stopId: number;
  }> = routeStopRows.map((stop, index) => ({
    ...stop,
    sequencePosition: index,
    stopId: Number(stop.id),
  }));

  const routeRows = rowsOf<DbRow>(await database.execute(sql`
    SELECT d.id,
           d.route_position,
           d.status,
           d.stop_status,
           COALESCE(d.company_id, o.company_id) AS effective_company_id,
           COALESCE(d.latitude, c.latitude)::text AS latitude,
           COALESCE(d.longitude, c.longitude)::text AS longitude,
           latest_event.status AS latest_event_status
    FROM deliveries d
    LEFT JOIN orders o ON o.id = d.order_id
    LEFT JOIN companies c ON c.id = COALESCE(d.company_id, o.company_id)
    LEFT JOIN LATERAL (
      SELECT e.status
      FROM delivery_stop_events e
      WHERE e.delivery_id = d.id
      ORDER BY e.registered_at DESC, e.id DESC
      LIMIT 1
    ) latest_event ON TRUE
    WHERE d.route_id = ${routeId}
      AND COALESCE(d.company_id, o.company_id) = ${companyId}
    ORDER BY d.route_position ASC NULLS LAST, d.id ASC
  `));
  const routeStopByDeliveryId = new Map<number, DbRow>();
  const usedRouteStopIds = new Set<number>();
  for (const row of routeRows) {
    const rowCompanyId = Number(row.effective_company_id);
    const candidates = routeStopsWithPosition.filter(
      (stop) => Number(stop.company_id) === rowCompanyId,
    );
    if (candidates.length === 0) continue;

    const available = candidates.filter((stop) => !usedRouteStopIds.has(stop.stopId));
    const candidatePool = available.length > 0 ? available : candidates;
    const deliveryLat = Number(row.latitude);
    const deliveryLng = Number(row.longitude);
    const hasDeliveryCoordinates = Number.isFinite(deliveryLat) && Number.isFinite(deliveryLng);
    const officialStop = candidatePool.reduce<DbRow | null>((best, stop) => {
      if (!hasDeliveryCoordinates) return best ?? stop;
      const stopLat = Number(stop.latitude);
      const stopLng = Number(stop.longitude);
      if (!Number.isFinite(stopLat) || !Number.isFinite(stopLng)) return best;
      const distance = calculateDistance(
        { lat: deliveryLat, lng: deliveryLng },
        { lat: stopLat, lng: stopLng },
      );
      if (!best) return { ...stop, matchDistance: distance };
      return distance < Number(best.matchDistance)
        ? { ...stop, matchDistance: distance }
        : best;
    }, null) ?? candidatePool[0];

    if (available.length > 0) usedRouteStopIds.add(officialStop.stopId);
    routeStopByDeliveryId.set(Number(row.id), officialStop);
  }
  const routeStops: TrackingStop[] = routeRows.map((row) => {
    const officialStop = routeStopByDeliveryId.get(Number(row.id));
    return {
      id: Number(row.id),
      routePosition: hasOfficialRouteStops
        ? officialStop?.sequencePosition ?? null
        : row.route_position == null ? null : Number(row.route_position),
      status: row.status == null ? null : String(row.status),
      stopStatus: row.latest_event_status == null
        ? row.stop_status == null ? null : String(row.stop_status)
        : String(row.latest_event_status),
      occurrenceStatus: row.latest_event_status == null
        ? row.stop_status == null ? null : String(row.stop_status)
        : String(row.latest_event_status),
      latitude: row.latitude,
      longitude: row.longitude,
      tempoEstimadoMin: officialStop?.tempo_estimado_min == null
        ? null
        : Number(officialStop.tempo_estimado_min),
      routeWindowStart: officialStop?.janela_inicio == null
        ? null
        : String(officialStop.janela_inicio),
      routeWindowEnd: officialStop?.janela_fim == null
        ? null
        : String(officialStop.janela_fim),
    };
  });
  // When route_stops exists it is authoritative. If the target delivery is
  // not represented there, a legacy route_position must not silently replace
  // the official operational sequence.
  if (
    hasOfficialRouteStops &&
    !routeStops.some((stop) => stop.id === Number(delivery.id) && stop.routePosition != null)
  ) return basePayload;

  const speedMetersPerSecond = Number(gps.speed);
  const speedKmh = Number.isFinite(speedMetersPerSecond) && speedMetersPerSecond > 0
    ? speedMetersPerSecond * 3.6
    : null;
  const plannedRouteStart = scheduledDate && delivery.route_start_time
    ? localDateTimeToInstant(scheduledDate, String(delivery.route_start_time))
    : null;
  const etaReferenceTime = new Date(Math.max(
    now.getTime(),
    journeyStartedAtMs,
    plannedRouteStart?.getTime() ?? Number.NEGATIVE_INFINITY,
  ));
  const trackingEta = calculateTrackingEta(
    routeStops,
    Number(delivery.id),
    { lat: gps.latitude, lng: gps.longitude },
    etaReferenceTime,
    speedKmh,
  );
  if (!routeStops.some((stop) => stop.id === Number(delivery.id))) return basePayload;

  const targetRouteStop = routeStopByDeliveryId.get(Number(delivery.id));
  const window = getEffectiveDeliveryWindow(
    delivery.delivery_config_json,
    scheduledDate,
    targetRouteStop?.janela_inicio == null ? null : String(targetRouteStop.janela_inicio),
    targetRouteStop?.janela_fim == null ? null : String(targetRouteStop.janela_fim),
  );
  const windowStart = window && scheduledDate
    ? localDateTimeToInstant(scheduledDate, window.startTime)
    : null;
  const windowEnd = window && scheduledDate
    ? localDateTimeToInstant(scheduledDate, window.endTime)
    : null;
  const etaEarliestAt = Math.max(
    windowStart?.getTime() ?? Number.NEGATIVE_INFINITY,
    journeyStartedAtMs,
    plannedRouteStart?.getTime() ?? Number.NEGATIVE_INFINITY,
  );
  const etaRange = makeEtaRange(
    trackingEta.etaAt,
    undefined,
    Number.isFinite(etaEarliestAt) ? new Date(etaEarliestAt) : null,
  );
  const delay = calculateTrackingDelay(trackingEta.etaAt, windowEnd, now);
  const delayed = status !== "delivered" &&
    status !== "cancelled" &&
    delay.delayed;
  const delayMinutes = delayed ? delay.delayMinutes : 0;
  const isNearby = isDriverNearby(
    { lat: gps.latitude, lng: gps.longitude },
    { lat: deliveryLocation.latitude, lng: deliveryLocation.longitude },
  );

  return buildPublicDeliveryTrackingPayload({
    status: isNearby ? "driver_nearby" : delayed ? "delayed" : "in_transit",
    deliveryStatus: "in_transit",
    trackingAvailable: true,
    scheduledDate,
    deliveryWindow: window,
    deliveredAt: null,
    lastUpdatedAt: gps.recorded_at,
    etaRange,
    stopsBefore: trackingEta.stopsBefore,
    isNextStop: trackingEta.isNextStop,
    isDriverNearby: isNearby,
    delayed,
    delayMinutes,
    message: isNearby
      ? "O motorista está nas proximidades do endereço da entrega."
      : delayed
        ? "A previsão foi ajustada para fora da janela prevista."
        : "A entrega está em rota. A previsão pode mudar conforme o trânsito e o andamento da rota.",
    deliveryLocation,
    driverPosition: {
      latitude: gps.latitude,
      longitude: gps.longitude,
      recordedAt: gps.recorded_at,
    },
  });
}

export async function getOrderDeliveryTracking(
  orderId: number,
  companyId: number,
  now: Date = new Date(),
  databaseOverride?: TrackingDatabase,
) {
  if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isInteger(companyId) || companyId <= 0) {
    return null;
  }

  const database = await getTrackingDatabase(databaseOverride);
  const orderRows = rowsOf(await database.execute(sql`
    SELECT o.id,
           o.company_id,
           o.status,
           o.delivery_date::text AS delivery_date,
           c.delivery_config_json,
           c.latitude::text AS company_latitude,
           c.longitude::text AS company_longitude
    FROM orders o
    JOIN companies c ON c.id = o.company_id
    WHERE o.id = ${orderId}
      AND o.company_id = ${companyId}
    LIMIT 1
  `));
  const order = orderRows[0];
  if (!order) return null;

  const deliveryRows = rowsOf(await database.execute(sql`
    SELECT id
    FROM deliveries
    WHERE order_id = ${orderId}
      AND company_id = ${companyId}
    ORDER BY id DESC
    LIMIT 1
  `));
  if (deliveryRows[0]) {
    return getDeliveryTracking(Number(deliveryRows[0].id), now, companyId, database);
  }

  const orderStatus = String(order.status ?? "");
  const deliveryStatus = orderStatus === "DELIVERED"
    ? "delivered"
    : orderStatus === "CANCELLED"
      ? "cancelled"
      : "scheduled";
  return buildScheduledPayload({
    deliveryStatus,
    scheduledDate: dateOnly(order.delivery_date),
    deliveryConfigJson: order.delivery_config_json,
    latitude: order.company_latitude,
    longitude: order.company_longitude,
  }, now);
}

export async function getPublicDeliveryTracking(
  deliveryId: number,
  now: Date = new Date(),
  databaseOverride?: TrackingDatabase,
) {
  if (!Number.isInteger(deliveryId) || deliveryId <= 0) return null;
  const database = await getTrackingDatabase(databaseOverride);
  const payload = await getDeliveryTracking(deliveryId, now, undefined, database);
  if (!payload) return null;

  const isTerminal = payload.deliveryStatus === "cancelled" || payload.deliveryStatus === "delivered";
  if (payload.deliveryStatus === "cancelled") return null;
  if (payload.deliveryStatus === "delivered") {
    const deliveredAt = payload.deliveredAt ? new Date(payload.deliveredAt).getTime() : NaN;
    if (!Number.isFinite(deliveredAt) || now.getTime() - deliveredAt > PUBLIC_DELIVERED_RETENTION_MS) {
      return null;
    }
  }

  const routeRows = rowsOf(await database.execute(sql`
    SELECT d.route_id,
           COALESCE(d.company_id, o.company_id) AS company_id,
           r.empresa_id AS route_company_id
    FROM deliveries d
    LEFT JOIN orders o ON o.id = d.order_id
    LEFT JOIN logistics_routes r ON r.id = d.route_id
    WHERE d.id = ${deliveryId}
    LIMIT 1
  `));
  const route = routeRows[0];
  if (!route?.route_id || Number(route.company_id) !== Number(route.route_company_id)) return null;
  if (isTerminal && payload.deliveryStatus !== "delivered") return null;
  return payload;
}
