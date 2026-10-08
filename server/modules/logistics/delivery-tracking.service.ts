import { sql } from "drizzle-orm";
import { db } from "../../database/db";
import {
  calculateTrackingEta,
  getDeliveryWindow,
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
  const delayed = deliveryStatus !== "delivered" &&
    deliveryStatus !== "cancelled" &&
    !!windowEnd &&
    now.getTime() > windowEnd.getTime();
  const delayMinutes = delayed && windowEnd
    ? Math.max(1, Math.ceil((now.getTime() - windowEnd.getTime()) / 60_000))
    : 0;

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

async function getDeliveryTracking(deliveryId: number, now: Date, expectedCompanyId?: number) {
  const baseRows = rowsOf(await db.execute(sql`
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

  const journeyRows = rowsOf(await db.execute(sql`
    SELECT id
    FROM driver_journeys
    WHERE driver_id = ${driverId}
      AND status = 'active'
      AND (empresa_id = ${companyId} OR empresa_id IS NULL)
    ORDER BY started_at DESC
    LIMIT 1
  `));
  if (journeyRows.length === 0) return basePayload;

  const gpsRows = rowsOf(await db.execute(sql`
    SELECT latitude::text AS latitude,
           longitude::text AS longitude,
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
    !Number.isFinite(Number(gps.latitude)) ||
    !Number.isFinite(Number(gps.longitude))
  ) return basePayload;

  const routeRows = rowsOf<DbRow>(await db.execute(sql`
    SELECT d.id,
           d.route_position,
           d.status,
           d.stop_status,
           COALESCE(d.latitude, c.latitude)::text AS latitude,
           COALESCE(d.longitude, c.longitude)::text AS longitude
    FROM deliveries d
    LEFT JOIN orders o ON o.id = d.order_id
    LEFT JOIN companies c ON c.id = COALESCE(d.company_id, o.company_id)
    WHERE d.route_id = ${routeId}
      AND COALESCE(d.company_id, o.company_id) = ${companyId}
    ORDER BY d.route_position ASC NULLS LAST, d.id ASC
  `));
  const routeStops: TrackingStop[] = routeRows.map((row) => ({
    id: Number(row.id),
    routePosition: row.route_position == null ? null : Number(row.route_position),
    status: row.status == null ? null : String(row.status),
    stopStatus: row.stop_status == null ? null : String(row.stop_status),
    latitude: row.latitude,
    longitude: row.longitude,
  }));
  const trackingEta = calculateTrackingEta(
    routeStops,
    Number(delivery.id),
    { lat: gps.latitude, lng: gps.longitude },
    now,
  );
  if (!routeStops.some((stop) => stop.id === Number(delivery.id))) return basePayload;

  const etaRange = makeEtaRange(trackingEta.etaAt);
  const window = getDeliveryWindow(delivery.delivery_config_json, scheduledDate);
  const windowEnd = window && scheduledDate
    ? localDateTimeToInstant(scheduledDate, window.endTime)
    : null;
  const etaEnd = etaRange ? new Date(etaRange.to) : null;
  const delayed = status !== "delivered" &&
    status !== "cancelled" &&
    (!!windowEnd && (
      now.getTime() > windowEnd.getTime() ||
      (!!etaEnd && etaEnd.getTime() > windowEnd.getTime())
    ));
  const delayMinutes = delayed && windowEnd
    ? Math.max(1, Math.ceil(((etaEnd && etaEnd > windowEnd ? etaEnd : now).getTime() - windowEnd.getTime()) / 60_000))
    : 0;
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
) {
  if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isInteger(companyId) || companyId <= 0) {
    return null;
  }

  const orderRows = rowsOf(await db.execute(sql`
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

  const deliveryRows = rowsOf(await db.execute(sql`
    SELECT id
    FROM deliveries
    WHERE order_id = ${orderId}
      AND company_id = ${companyId}
    ORDER BY id DESC
    LIMIT 1
  `));
  if (deliveryRows[0]) {
    return getDeliveryTracking(Number(deliveryRows[0].id), now, companyId);
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
) {
  if (!Number.isInteger(deliveryId) || deliveryId <= 0) return null;
  const payload = await getDeliveryTracking(deliveryId, now);
  if (!payload) return null;

  const isTerminal = payload.deliveryStatus === "cancelled" || payload.deliveryStatus === "delivered";
  if (payload.deliveryStatus === "cancelled") return null;
  if (payload.deliveryStatus === "delivered") {
    const deliveredAt = payload.deliveredAt ? new Date(payload.deliveredAt).getTime() : NaN;
    if (!Number.isFinite(deliveredAt) || now.getTime() - deliveredAt > PUBLIC_DELIVERED_RETENTION_MS) {
      return null;
    }
  }

  const routeRows = rowsOf(await db.execute(sql`
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
