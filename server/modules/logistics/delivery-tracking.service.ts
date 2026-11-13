import { sql } from "drizzle-orm";
import { routeAuthorizesCompany } from "./auto-dispatch.policy";
import { calculateRoadEta, isRoadRoutingConfigured } from "./road-routing.service";
import {
  calculateTrackingDelay,
  getDeliveryWindow,
  getEffectiveDeliveryWindow,
  isDriverNearby,
  isFreshTrackingGps,
  hasValidTrackingCoordinates,
  localDateTimeToInstant,
  makeEtaRange,
  normalizeTrackingStatus,
  isCompletedTrackingStop,
  TRACKING_GPS_MAX_AGE_MS,
  PUBLIC_DELIVERED_RETENTION_MS,
  type TrackingStop,
} from "./delivery-tracking.logic";
import { buildPublicDeliveryTrackingPayload } from "./public-tracking.dto";

type DbRow = Record<string, any>;
export type OrderTrackingOperationalState =
  | "scheduled"
  | "awaiting_assignment"
  | "awaiting_start"
  | "awaiting_gps"
  | "location_stale"
  | "awaiting_route_data"
  | "admin_test_preview"
  | "admin_test_preview_no_gps"
  | "in_transit";

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

function withOrderOperationalState<T extends Record<string, any>>(
  payload: T,
  state: OrderTrackingOperationalState | "delivered" | "cancelled",
  includeOperationalState: boolean,
  gpsRecordedAt?: Date | string | null,
) {
  if (!includeOperationalState) return payload;
  return {
    ...payload,
    operationalState: state,
    ...(gpsRecordedAt != null ? { gpsRecordedAt } : {}),
  };
}

async function getDeliveryTracking(
  deliveryId: number,
  now: Date,
  expectedCompanyId: number | undefined,
  database: TrackingDatabase,
  includeOperationalState = false,
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
           to_jsonb(d)->>'customer_tracking_preview_until' AS customer_tracking_preview_until,
           o.company_id AS order_company_id,
           o.status AS order_status,
           o.delivery_date::text AS order_delivery_date,
           c.delivery_config_json,
           c.latitude::text AS company_latitude,
           c.longitude::text AS company_longitude,
           r.empresa_id AS route_company_id,
           r.company_ids AS route_company_ids,
           r.driver_id AS route_driver_id,
           r.status AS route_status,
           r.start_time AS route_start_time,
           ld.active AS driver_active,
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
      : delivery.delivery_status;
  const status = normalizeTrackingStatus(effectiveDeliveryStatus);
  if (status === "cancelled") {
    return withOrderOperationalState(buildScheduledPayload({
      deliveryStatus: "cancelled",
      scheduledDate,
      deliveryConfigJson: delivery.delivery_config_json,
      ...deliveryLocation,
      deliveredAt: delivery.delivered_at,
      updatedAt: delivery.updated_at,
    }, now), "cancelled", includeOperationalState);
  }

  if (status === "delivered") {
    return withOrderOperationalState(buildScheduledPayload({
      deliveryStatus: "delivered",
      scheduledDate,
      deliveryConfigJson: delivery.delivery_config_json,
      ...deliveryLocation,
      deliveredAt: delivery.delivered_at,
      updatedAt: delivery.updated_at,
    }, now), "delivered", includeOperationalState);
  }

  const basePayload = buildScheduledPayload({
      deliveryStatus: effectiveDeliveryStatus,
    scheduledDate,
    deliveryConfigJson: delivery.delivery_config_json,
    ...deliveryLocation,
    deliveredAt: delivery.delivered_at,
    updatedAt: delivery.updated_at,
  }, now);
  const markedInRoute = normalizeTrackingStatus(effectiveDeliveryStatus) === "in_progress";
  const fallbackState: OrderTrackingOperationalState = markedInRoute ? "awaiting_gps" : "scheduled";
  const fallback = (
    state: OrderTrackingOperationalState = fallbackState,
    gpsRecordedAt?: Date | string | null,
  ) => withOrderOperationalState(basePayload, state, includeOperationalState, gpsRecordedAt);

  const routeId = Number(delivery.route_id);
  const driverId = Number(delivery.driver_id ?? delivery.route_driver_id);
  const routeCompanyId = Number(delivery.route_company_id);
  const driverCompanyId = Number(delivery.driver_company_id);
  if (!Number.isInteger(routeId) || routeId <= 0) return fallback();
  if (!routeAuthorizesCompany(delivery.route_company_ids, companyId)) return fallback();
  if (!Number.isInteger(driverId) || driverId <= 0) return fallback("awaiting_assignment");

  const consistentRoute =
    (delivery.driver_id == null || delivery.route_driver_id == null ||
      Number(delivery.driver_id) === Number(delivery.route_driver_id)) &&
    Number.isInteger(routeCompanyId) && routeCompanyId > 0 &&
    driverCompanyId === routeCompanyId;

  // A public delivery capability is no longer useful after route unlinking.
  // The authenticated order page still receives the safe scheduled state.
  if (!consistentRoute || !Number.isInteger(driverId) || driverId <= 0) {
    return fallback();
  }
  // A deleted driver account deactivates its operational record. Keep the
  // route and delivery history, but stop sharing the driver's live location.
  if (delivery.driver_active === false || delivery.driver_active === "false") {
    return fallback("awaiting_assignment");
  }

  // Administrative test preview is a time-limited exception for the client
  // tracking screen only. It keeps the company/route/driver checks above and
  // never mutates route, journey, delivery status, or GPS data. A displayed
  // point is always an actual stored GPS fix and is labelled as possibly stale.
  const previewUntilMs = delivery.customer_tracking_preview_until == null
    ? Number.NaN
    : new Date(delivery.customer_tracking_preview_until).getTime();
  if (includeOperationalState && Number.isFinite(previewUntilMs) && previewUntilMs > now.getTime()) {
    const previewGpsRows = rowsOf(await database.execute(sql`
      SELECT latitude::text AS latitude,
             longitude::text AS longitude,
             recorded_at
      FROM driver_gps_positions
      WHERE driver_id = ${driverId}
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1
    `));
    const previewGps = previewGpsRows[0];
    if (!previewGps || !hasValidTrackingCoordinates(previewGps.latitude, previewGps.longitude)) {
      return withOrderOperationalState({
        ...basePayload,
        trackingAvailable: false,
        message: "Prévia administrativa de teste habilitada, mas ainda não há posição GPS registrada para exibir.",
        driverPosition: null,
        trackingPreview: true,
      }, "admin_test_preview_no_gps", true);
    }
    return withOrderOperationalState({
      ...basePayload,
      trackingAvailable: true,
      etaRange: null,
      etaMethod: null,
      roadDistanceKm: null,
      stopsBefore: null,
      isNextStop: false,
      isDriverNearby: false,
      message: "Prévia administrativa de teste: esta é a última posição registrada e pode estar desatualizada.",
      trackingPreview: true,
      driverPosition: {
        // Keep the same intentionally approximate public shape as live GPS.
        lat: Number(Number(previewGps.latitude).toFixed(2)).toFixed(2),
        lng: Number(Number(previewGps.longitude).toFixed(2)).toFixed(2),
        updatedAt: previewGps.recorded_at instanceof Date
          ? previewGps.recorded_at.toISOString()
          : new Date(previewGps.recorded_at).toISOString(),
      },
    }, "admin_test_preview", true, previewGps.recorded_at);
  }

  const routeActive = normalizeTrackingStatus(delivery.route_status) === "in_progress";
  if (!routeActive) return fallback("awaiting_start");

  const journeyRows = rowsOf(await database.execute(sql`
    SELECT id, started_at
    FROM driver_journeys
    WHERE driver_id = ${driverId}
      AND status = 'active'
      AND (empresa_id = ${routeCompanyId} OR empresa_id IS NULL)
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `));
  if (journeyRows.length === 0) return fallback("awaiting_start");
  const journeyStartedAtMs = new Date(journeyRows[0].started_at).getTime();
  if (!Number.isFinite(journeyStartedAtMs)) return fallback("awaiting_start");

  const gpsRows = rowsOf(await database.execute(sql`
     SELECT latitude::text AS latitude,
            longitude::text AS longitude,
           speed::text AS speed,
           recorded_at
    FROM driver_gps_positions
    WHERE driver_id = ${driverId}
     ORDER BY recorded_at DESC, id DESC
    LIMIT 1
  `));
  const gps = gpsRows[0];
  if (!gps) return fallback("awaiting_gps");
  const gpsTimestamp = new Date(gps.recorded_at).getTime();
  if (!Number.isFinite(gpsTimestamp) || gpsTimestamp < journeyStartedAtMs) {
    return fallback("awaiting_gps");
  }
  if (now.getTime() - gpsTimestamp > TRACKING_GPS_MAX_AGE_MS) {
    return fallback("location_stale", gps.recorded_at);
  }
  if (!isFreshTrackingGps(gps.recorded_at, now) || !hasValidTrackingCoordinates(gps.latitude, gps.longitude)) {
    return fallback("awaiting_gps", gps.recorded_at);
  }

  // Deliveries are the canonical stops for a multi-company route. route_stops
  // has no delivery_id link, so coordinates/order similarity cannot prove
  // which delivery a manual stop represents.
  const routeRows = rowsOf<DbRow>(await database.execute(sql`
    SELECT d.id,
           d.route_position,
           d.status,
           d.stop_status,
           COALESCE(d.company_id, o.company_id) AS effective_company_id,
           COALESCE(d.latitude, c.latitude)::text AS latitude,
           COALESCE(d.longitude, c.longitude)::text AS longitude,
            c.delivery_config_json AS company_delivery_config_json,
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
    ORDER BY d.route_position ASC NULLS LAST, d.id ASC
  `));
  const routeStops: TrackingStop[] = routeRows.map((row) => {
    const effectiveWindow = getEffectiveDeliveryWindow(
      row.company_delivery_config_json ?? delivery.delivery_config_json,
      scheduledDate,
      null,
      null,
    );
    return {
      id: Number(row.id),
      routePosition: row.route_position == null ? null : Number(row.route_position),
      status: row.status == null ? null : String(row.status),
      stopStatus: row.latest_event_status == null
        ? row.stop_status == null ? null : String(row.stop_status)
        : String(row.latest_event_status),
      occurrenceStatus: row.latest_event_status == null
        ? row.stop_status == null ? null : String(row.stop_status)
        : String(row.latest_event_status),
      latitude: row.latitude,
      longitude: row.longitude,
      tempoEstimadoMin: null,
      routeWindowStart: null,
      routeWindowEnd: null,
      windowStartAt: effectiveWindow && scheduledDate
        ? localDateTimeToInstant(scheduledDate, effectiveWindow.startTime)
        : null,
      windowEndAt: effectiveWindow && scheduledDate
        ? localDateTimeToInstant(scheduledDate, effectiveWindow.endTime)
        : null,
    };
  });
  const plannedRouteStart = scheduledDate && delivery.route_start_time
    ? localDateTimeToInstant(scheduledDate, String(delivery.route_start_time))
    : null;
  const etaReferenceTime = new Date(Math.max(
    now.getTime(),
    journeyStartedAtMs,
    plannedRouteStart?.getTime() ?? Number.NEGATIVE_INFINITY,
  ));
  const orderedRouteStops = [...routeStops].sort((left, right) =>
    (left.routePosition ?? Number.MAX_SAFE_INTEGER) - (right.routePosition ?? Number.MAX_SAFE_INTEGER) ||
    left.id - right.id,
  );
  const targetStopIndex = orderedRouteStops.findIndex((stop) => stop.id === Number(delivery.id));
  if (targetStopIndex < 0) return fallback("awaiting_route_data");
  const stopsBefore = orderedRouteStops
    .slice(0, targetStopIndex)
    .filter((stop) => !isCompletedTrackingStop(stop)).length;
  const stopsThroughTarget = orderedRouteStops
    .slice(0, targetStopIndex + 1)
    .filter((stop, index) => index === targetStopIndex || !isCompletedTrackingStop(stop))
    .map((stop, index, list) => ({
      ...stop,
      // The legacy stop-status column can hold delivery completion even when
      // the delivery status itself has not yet been normalized.
      status: isCompletedTrackingStop(stop) ? "delivered" : stop.status,
      includeDwell: index < list.length - 1,
    }));
  const roadEta = await calculateRoadEta(
    stopsThroughTarget,
    { latitude: gps.latitude, longitude: gps.longitude },
    etaReferenceTime,
  );
  const targetEta = roadEta?.stops.at(-1);
  const etaAt = targetEta?.etaTime ? new Date(targetEta.etaTime) : null;

  const window = getEffectiveDeliveryWindow(
    delivery.delivery_config_json,
    scheduledDate,
    null,
    null,
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
    etaAt,
    5,
    Number.isFinite(etaEarliestAt) ? new Date(etaEarliestAt) : null,
  );
  const delay = calculateTrackingDelay(etaAt, windowEnd, now);
  const delayed = status !== "delivered" &&
    status !== "cancelled" &&
    delay.delayed;
  const delayMinutes = delayed ? delay.delayMinutes : 0;
  const isNearby = isDriverNearby(
    { lat: gps.latitude, lng: gps.longitude },
    { lat: deliveryLocation.latitude, lng: deliveryLocation.longitude },
  );

  const payload = buildPublicDeliveryTrackingPayload({
    status: isNearby ? "driver_nearby" : delayed ? "delayed" : "in_transit",
    deliveryStatus: "in_transit",
    trackingAvailable: true,
    scheduledDate,
    deliveryWindow: window,
    deliveredAt: null,
    lastUpdatedAt: gps.recorded_at,
    etaRange,
    // Route-level stop counts can reveal operational activity from other
    // companies. Keep the ETA but expose no cross-company stop metadata.
    stopsBefore: null,
    isNextStop: false,
    isDriverNearby: isNearby,
    etaMethod: etaAt ? "osrm_openstreetmap" : null,
    roadDistanceKm: targetEta?.distanceKm == null
      ? null
      : Number(roadEta?.stops.reduce((total, stop) => total + (stop.distanceKm ?? 0), 0).toFixed(1)),
    delayed,
    delayMinutes,
    message: isNearby
      ? "O motorista está nas proximidades do endereço da entrega."
      : delayed
        ? "A previsão foi ajustada para fora da janela prevista."
        : etaAt
          ? "Previsão calculada pela malha viária. Ela pode mudar conforme a rota avança; o serviço não fornece trânsito ao vivo."
          : isRoadRoutingConfigured()
            ? "A posição está atualizada, mas o provedor de rotas não retornou uma estimativa agora."
            : "A posição está atualizada. A estimativa pela malha viária aguarda configuração do serviço de rotas.",
    deliveryLocation,
    driverPosition: {
      latitude: gps.latitude,
      longitude: gps.longitude,
      recordedAt: gps.recorded_at,
    },
  });
  return withOrderOperationalState(payload, "in_transit", includeOperationalState, gps.recorded_at);
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
    SELECT d.id, d.status, d.delivered_at
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    WHERE d.order_id = ${orderId}
      AND o.company_id = ${companyId}
      AND (d.company_id IS NULL OR d.company_id = o.company_id)
    ORDER BY d.scheduled_date ASC NULLS LAST, d.route_position ASC NULLS LAST, d.id ASC
  `));
  const orderStatus = String(order.status ?? "");
  const deliveryStatus = orderStatus === "DELIVERED"
    ? "delivered"
    : orderStatus === "CANCELLED"
      ? "cancelled"
      : "scheduled";
  const scheduledPayload = withOrderOperationalState(buildScheduledPayload({
    deliveryStatus,
    scheduledDate: dateOnly(order.delivery_date),
    deliveryConfigJson: order.delivery_config_json,
    latitude: order.company_latitude,
    longitude: order.company_longitude,
  }, now), deliveryStatus === "delivered" ? "delivered" : deliveryStatus === "cancelled" ? "cancelled" : "scheduled", true);

  if (deliveryRows.length === 0) return scheduledPayload;

  const deliveryPayloads = await Promise.all(
    deliveryRows.map((row) =>
      getDeliveryTracking(Number(row.id), now, companyId, database, true),
    ),
  );
  if (deliveryRows.length === 1) return deliveryPayloads[0] ?? scheduledPayload;

  if (orderStatus.toUpperCase() === "CANCELLED") {
    return scheduledPayload;
  }

  const statuses = deliveryRows.map((row) => normalizeTrackingStatus(row.status));
  const deliveredIndexes = statuses.flatMap((status, index) => status === "delivered" ? [index] : []);
  const cancelledIndexes = statuses.flatMap((status, index) => status === "cancelled" ? [index] : []);
  const openIndexes = statuses.flatMap((status, index) =>
    status === "delivered" || status === "cancelled" ? [] : [index],
  );

  const deliveredAt = deliveredIndexes
    .map((index) => deliveryRows[index]?.delivered_at ?? deliveryPayloads[index]?.deliveredAt)
    .filter((value): value is Date | string => value != null)
    .sort((left, right) => timestampMillis(right) - timestampMillis(left))[0] ?? null;

  if (deliveredIndexes.length === deliveryRows.length) {
    const latest = deliveryPayloads[deliveredIndexes[0]] ?? scheduledPayload;
    return {
      ...latest,
      status: "delivered",
      deliveryStatus: "delivered",
      trackingAvailable: false,
      deliveredAt,
      message: "Todas as entregas deste pedido foram concluídas.",
    };
  }

  if (cancelledIndexes.length === deliveryRows.length) {
    return {
      ...(deliveryPayloads[cancelledIndexes[0]] ?? scheduledPayload),
      status: "cancelled",
      deliveryStatus: "cancelled",
      trackingAvailable: false,
      message: "Todas as entregas deste pedido foram canceladas.",
    };
  }

  const activeIndexes = openIndexes.length > 0
    ? openIndexes
    : [...deliveredIndexes, ...cancelledIndexes];
  const selectedIndex = activeIndexes.find((index) => deliveryPayloads[index]?.trackingAvailable) ?? activeIndexes[0];
  const current = selectedIndex == null ? scheduledPayload : deliveryPayloads[selectedIndex] ?? scheduledPayload;

  if (deliveredIndexes.length > 0) {
    return {
      ...current,
      status: "partially_delivered",
      deliveryStatus: "partially_delivered",
      deliveredAt: deliveredAt == null
        ? null
        : deliveredAt instanceof Date
          ? deliveredAt.toISOString()
          : new Date(deliveredAt).toISOString(),
      message: `${deliveredIndexes.length} de ${deliveryRows.length} entregas deste pedido foram concluídas. ${openIndexes.length > 0 ? "As demais ainda estão em andamento." : "As demais paradas foram canceladas."}`,
    };
  }

  if (cancelledIndexes.length > 0) {
    return {
      ...current,
      message: "Uma parada foi cancelada. Acompanhe as demais entregas deste pedido.",
    };
  }

  return current;
}

function timestampMillis(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
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
           r.empresa_id AS route_company_id,
           r.company_ids AS route_company_ids
    FROM deliveries d
    LEFT JOIN orders o ON o.id = d.order_id
    LEFT JOIN logistics_routes r ON r.id = d.route_id
    WHERE d.id = ${deliveryId}
    LIMIT 1
  `));
  const route = routeRows[0];
  if (!route?.route_id || !routeAuthorizesCompany(route.route_company_ids, Number(route.company_id))) return null;
  if (isTerminal && payload.deliveryStatus !== "delivered") return null;
  return payload;
}
