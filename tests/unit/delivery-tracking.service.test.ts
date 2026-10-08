import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  getOrderDeliveryTracking,
  getPublicDeliveryTracking,
} from "../../server/modules/logistics/delivery-tracking.service";

const now = new Date("2026-10-08T12:00:00.000Z");

const activeDelivery = {
  id: 40,
  order_id: 90,
  company_id: 3,
  driver_id: 7,
  route_id: 12,
  delivery_status: "pendente",
  scheduled_date: "2026-10-08",
  delivered_at: null,
  route_position: 1,
  stop_status: null,
  stop_status_at: null,
  delivery_latitude: "-23.55",
  delivery_longitude: "-46.63",
  updated_at: now,
  order_company_id: 3,
  order_status: "CONFIRMED",
  order_delivery_date: "2026-10-08",
  delivery_config_json: JSON.stringify({
    "quinta-feira": { enabled: true, startTime: "08:00", endTime: "10:00" },
  }),
  company_latitude: "-23.55",
  company_longitude: "-46.63",
  route_company_id: 3,
  route_driver_id: 7,
  route_status: "IN_PROGRESS",
  route_start_time: "08:00",
  route_has_stops: true,
  driver_company_id: 3,
};

const routeRow = {
  route_id: 12,
  company_id: 3,
  route_company_id: 3,
};

async function withDbResults<T>(
  results: unknown[],
  callback: (database: { execute: (...args: any[]) => Promise<unknown> }) => Promise<T>,
) {
  let calls = 0;
  const database = {
    execute: async (..._args: any[]) => {
      const result = results[calls] ?? [];
      calls++;
      return result;
    },
  };
  return { result: await callback(database), calls: () => calls };
}

function validTrackingResults(overrides: {
  delivery?: Record<string, unknown>;
  journey?: Record<string, unknown> | null;
  gps?: Record<string, unknown> | null;
  routeStops?: Record<string, unknown>[];
  routeDeliveries?: Record<string, unknown>[];
  finalRoute?: Record<string, unknown> | null;
} = {}) {
  const delivery = { ...activeDelivery, ...(overrides.delivery ?? {}) };
  const journey = overrides.journey === undefined
    ? { id: 5, started_at: new Date(now.getTime() - 60_000) }
    : overrides.journey;
  const gps = overrides.gps === undefined
    ? {
        latitude: "-23.56",
        longitude: "-46.64",
        speed: "4",
        recorded_at: new Date(now.getTime() - 15_000),
      }
    : overrides.gps;
  return [
    [delivery],
    journey ? [journey] : [],
    gps ? [gps] : [],
    overrides.routeStops ?? [{
      company_id: 3,
      ordem_parada: 1,
      janela_inicio: null,
      janela_fim: null,
      tempo_estimado_min: 8,
    }],
    overrides.routeDeliveries ?? [{
      id: 40,
      route_position: 1,
      status: "pendente",
      stop_status: null,
      effective_company_id: 3,
      latitude: "-23.55",
      longitude: "-46.63",
      latest_event_status: null,
    }],
    overrides.finalRoute === null ? [] : [overrides.finalRoute ?? routeRow],
  ];
}

describe("public delivery tracking operational availability", () => {
  test("does not release detailed tracking before route, journey, and fresh post-start GPS exist", async () => {
    const noDriver = [
      [{ ...activeDelivery, driver_id: null, route_driver_id: null }],
      [routeRow],
    ];
    const noDriverResult = await withDbResults(noDriver, (database) =>
      getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(noDriverResult.result?.trackingAvailable, false);

    const noJourneyResult = await withDbResults(
      [[activeDelivery], [], [routeRow]],
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(noJourneyResult.result?.trackingAvailable, false);

    const noGpsResult = await withDbResults(
      [[activeDelivery], [{ id: 5, started_at: new Date(now.getTime() - 60_000) }], [], [routeRow]],
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(noGpsResult.result?.trackingAvailable, false);

    const staleGpsResult = await withDbResults(
      [
        [activeDelivery],
        [{ id: 5, started_at: new Date(now.getTime() - 60_000) }],
        [{
          latitude: "-23.56",
          longitude: "-46.64",
          speed: null,
          recorded_at: new Date(now.getTime() - 6 * 60_000),
        }],
        [routeRow],
      ],
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(staleGpsResult.result?.trackingAvailable, false);

    const preJourneyGpsResult = await withDbResults(
      [
        [activeDelivery],
        [{ id: 5, started_at: new Date(now.getTime() - 10_000) }],
        [{
          latitude: "-23.56",
          longitude: "-46.64",
          speed: null,
          recorded_at: new Date(now.getTime() - 20_000),
        }],
        [routeRow],
      ],
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(preJourneyGpsResult.result?.trackingAvailable, false);
  });

  test("returns a safe ETA range only after an active route, active journey, and current GPS", async () => {
    const { result, calls } = await withDbResults(
      validTrackingResults(),
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(calls(), 6);
    assert.equal(result?.trackingAvailable, true);
    assert.equal(result?.deliveryStatus, "in_transit");
    assert.ok(result?.etaRange);
    assert.equal(result?.stopsBefore, 0);
    assert.equal(result?.isNextStop, true);
    assert.equal("speed" in (result?.driverPosition ?? {}), false);
  });

  test("recalculates the ETA when the driver's current GPS moves", async () => {
    const routeStops = [{
      id: 1,
      company_id: 3,
      ordem_parada: 1,
      latitude: "-23.55",
      longitude: "-46.63",
      janela_inicio: null,
      janela_fim: null,
      tempo_estimado_min: 8,
    }];
    const far = await withDbResults(
      validTrackingResults({
        routeStops,
        gps: {
          latitude: "-23.55",
          longitude: "-46.70",
          speed: "4",
          recorded_at: new Date(now.getTime() - 15_000),
        },
      }),
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    const near = await withDbResults(
      validTrackingResults({
        routeStops,
        gps: {
          latitude: "-23.55",
          longitude: "-46.63",
          speed: "4",
          recorded_at: new Date(now.getTime() - 15_000),
        },
      }),
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.notDeepEqual(far.result?.etaRange, near.result?.etaRange);
  });

  test("uses stop order from route_stops instead of stale delivery route_position values", async () => {
    const result = await withDbResults(
      validTrackingResults({
        routeStops: [
          {
            id: 101,
            company_id: 3,
            ordem_parada: 1,
            latitude: "-23.55",
            longitude: "-46.70",
            janela_inicio: null,
            janela_fim: null,
            tempo_estimado_min: 8,
          },
          {
            id: 102,
            company_id: 3,
            ordem_parada: 2,
            latitude: "-23.55",
            longitude: "-46.63",
            janela_inicio: null,
            janela_fim: null,
            tempo_estimado_min: 8,
          },
        ],
        routeDeliveries: [
          {
            id: 40,
            route_position: 0,
            status: "pendente",
            stop_status: null,
            effective_company_id: 3,
            latitude: "-23.55",
            longitude: "-46.63",
            latest_event_status: null,
          },
          {
            id: 39,
            route_position: 1,
            status: "pendente",
            stop_status: null,
            effective_company_id: 3,
            latitude: "-23.55",
            longitude: "-46.70",
            latest_event_status: null,
          },
        ],
      }),
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(result.result?.trackingAvailable, true);
    assert.equal(result.result?.stopsBefore, 1);
    assert.equal(result.result?.isNextStop, false);
  });

  test("uses route_stops order and window, and refuses legacy-order fallback for an unrepresented target", async () => {
    const routeStops = [
      {
        company_id: 3,
        ordem_parada: 2,
        janela_inicio: "09:00",
        janela_fim: "11:00",
        tempo_estimado_min: 12,
      },
    ];
    const included = await withDbResults(
      validTrackingResults({ routeStops }),
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(included.result?.trackingAvailable, true);
    assert.deepEqual(included.result?.deliveryWindow, {
      startTime: "09:00",
      endTime: "11:00",
    });

    const unrepresented = await withDbResults(
      validTrackingResults({
        routeStops,
        routeDeliveries: [{
          id: 40,
          route_position: 1,
          status: "pendente",
          stop_status: null,
          effective_company_id: 99,
          latitude: "-23.55",
          longitude: "-46.63",
          latest_event_status: null,
        }],
      }),
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(unrepresented.result?.trackingAvailable, false);
  });

  test("does not release detailed tracking when the route has not started", async () => {
    const { result } = await withDbResults(
      [[{ ...activeDelivery, route_status: "SCHEDULED" }], [routeRow]],
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(result?.trackingAvailable, false);
  });

  test("does not use legacy order when the route has official stops owned by another scope", async () => {
    const { result } = await withDbResults(
      [
        [activeDelivery],
        [{ id: 5, started_at: new Date(now.getTime() - 60_000) }],
        [{
          latitude: "-23.56",
          longitude: "-46.64",
          speed: null,
          recorded_at: new Date(now.getTime() - 15_000),
        }],
        [],
        [routeRow],
      ],
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(result?.trackingAvailable, false);
  });

  test("uses a future planned route start as the earliest possible ETA", async () => {
    const { result } = await withDbResults(
      validTrackingResults({
        delivery: { route_start_time: "10:00" },
        gps: {
          latitude: "-23.55",
          longitude: "-46.63",
          speed: "4",
          recorded_at: new Date(now.getTime() - 15_000),
        },
        routeStops: [{
          id: 1,
          company_id: 3,
          ordem_parada: 1,
          latitude: "-23.55",
          longitude: "-46.63",
          janela_inicio: null,
          janela_fim: null,
          tempo_estimado_min: 8,
        }],
      }),
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.ok(result?.etaRange);
    assert.ok(result.etaRange.from >= "2026-10-08T13:00:00.000Z");
  });

  test("does not expose cancelled or long-expired completed deliveries", async () => {
    const cancelled = await withDbResults(
      validTrackingResults({
        delivery: { delivery_status: "cancelado" },
      }),
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(cancelled.result, null);

    const oldDelivery = await withDbResults(
      validTrackingResults({
        delivery: {
          delivery_status: "entregue",
          order_status: "DELIVERED",
          delivered_at: new Date(now.getTime() - 25 * 60 * 60_000),
        },
      }),
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(oldDelivery.result, null);
  });

  test("rejects public tracking when the route no longer belongs to the delivery tenant", async () => {
    const { result } = await withDbResults(
      validTrackingResults({
        finalRoute: { ...routeRow, route_company_id: 9 },
      }),
      (database) => getPublicDeliveryTracking(40, now, database),
    );
    assert.equal(result, null);
  });
});

describe("authenticated order tracking fallback", () => {
  test("shows a scheduled state for an order with no delivery row and scopes the order by company", async () => {
    const results = [
      [{
        id: 90,
        company_id: 3,
        status: "CONFIRMED",
        delivery_date: "2026-10-08",
        delivery_config_json: activeDelivery.delivery_config_json,
        company_latitude: "-23.55",
        company_longitude: "-46.63",
      }],
      [],
    ];
    const { result, calls } = await withDbResults(results, (database) =>
      getOrderDeliveryTracking(90, 3, now, database),
    );
    assert.equal(calls(), 2);
    assert.equal(result?.trackingAvailable, false);
    assert.equal(result?.status, "scheduled");
  });
});
