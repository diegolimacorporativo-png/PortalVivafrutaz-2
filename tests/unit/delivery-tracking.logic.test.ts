import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  calculateTrackingDelay,
  calculateTrackingEta,
  getDeliveryWindow,
  getEffectiveDeliveryWindow,
  isFreshTrackingGps,
  localDateTimeToInstant,
  makeEtaRange,
  type TrackingStop,
} from "../../server/modules/logistics/delivery-tracking.logic";
import { calculateETA } from "../../server/modules/logistics/eta.service";

const fixedNow = new Date("2026-10-08T12:00:00.000Z");

describe("delivery tracking GPS and delivery windows", () => {
  test("accepts a current GPS fix and rejects stale, excessively future, and invalid timestamps", () => {
    assert.equal(isFreshTrackingGps(new Date(fixedNow.getTime() - 4 * 60_000), fixedNow), true);
    assert.equal(isFreshTrackingGps(new Date(fixedNow.getTime() - 6 * 60_000), fixedNow), false);
    assert.equal(isFreshTrackingGps(new Date(fixedNow.getTime() + 20_000), fixedNow), true);
    assert.equal(isFreshTrackingGps(new Date(fixedNow.getTime() + 40_000), fixedNow), false);
    assert.equal(isFreshTrackingGps("not-a-date", fixedNow), false);
  });

  test("selects the configured weekday window and prefers a valid route-stop window", () => {
    const config = JSON.stringify({
      "quinta-feira": { enabled: true, startTime: "08:00", endTime: "10:00" },
    });
    assert.deepEqual(getDeliveryWindow(config, "2026-10-08"), {
      startTime: "08:00",
      endTime: "10:00",
    });
    assert.deepEqual(
      getEffectiveDeliveryWindow(config, "2026-10-08", "09:15", "11:30"),
      { startTime: "09:15", endTime: "11:30" },
    );
    assert.deepEqual(
      getEffectiveDeliveryWindow(config, "2026-10-08", "12:00", "10:00"),
      { startTime: "08:00", endTime: "10:00" },
    );
  });

  test("converts the configured Sao Paulo local time to the correct instant", () => {
    assert.equal(
      localDateTimeToInstant("2026-10-08", "08:00")?.toISOString(),
      "2026-10-08T11:00:00.000Z",
    );
  });
});

describe("delivery tracking route ETA", () => {
  test("counts only pending stops before the target and identifies the next stop", () => {
    const stops: TrackingStop[] = [
      { id: 11, routePosition: 0, status: "entregue", stopStatus: "entregue", latitude: 0, longitude: 0 },
      { id: 12, routePosition: 1, status: "pendente", stopStatus: null, latitude: 0, longitude: 0 },
      { id: 13, routePosition: 2, status: "pendente", stopStatus: null, latitude: 0, longitude: 0 },
    ];
    const result = calculateTrackingEta(stops, 13, { lat: 0, lng: 0 }, fixedNow);
    assert.equal(result.stopsBefore, 1);
    assert.equal(result.isNextStop, false);

    const next = calculateTrackingEta(stops, 12, { lat: 0, lng: 0 }, fixedNow);
    assert.equal(next.stopsBefore, 0);
    assert.equal(next.isNextStop, true);
  });

  test("handles a ten-stop route, skips completed deliveries, and reacts to a changed route order", () => {
    const stops: TrackingStop[] = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      routePosition: index,
      status: index < 3 ? "entregue" : "pendente",
      stopStatus: null,
      latitude: 0,
      longitude: index / 100,
    }));
    assert.equal(
      calculateTrackingEta(stops, 10, { lat: 0, lng: 0 }, fixedNow).stopsBefore,
      6,
    );
    const moved = stops.map((stop) => ({
      ...stop,
      routePosition: stop.id === 10 ? 0 : stop.id,
    }));
    assert.equal(
      calculateTrackingEta(moved, 10, { lat: 0, lng: 0 }, fixedNow).stopsBefore,
      0,
    );
  });

  test("uses measured speed when valid and the existing route average otherwise", () => {
    const stops = [{ id: 1, latitude: 0, longitude: 1, includeDwell: false }];
    const slow = calculateETA(stops, { lat: 0, lng: 0 }, fixedNow, { speedKmh: 20 })[0];
    const fast = calculateETA(stops, { lat: 0, lng: 0 }, fixedNow, { speedKmh: 60 })[0];
    const invalid = calculateETA(stops, { lat: 0, lng: 0 }, fixedNow, { speedKmh: 0 })[0];
    assert.ok(slow.etaMinutes > invalid.etaMinutes);
    assert.ok(fast.etaMinutes < invalid.etaMinutes);
  });

  test("adds time for a prior unresolved occurrence without exposing its text", () => {
    const base: TrackingStop[] = [
      { id: 1, routePosition: 0, status: "pendente", stopStatus: null, latitude: 0, longitude: 0, tempoEstimadoMin: 8 },
      { id: 2, routePosition: 1, status: "pendente", stopStatus: null, latitude: 0, longitude: 1 },
    ];
    const delayed = calculateTrackingEta(
      [{ ...base[0], occurrenceStatus: "problema" }, base[1]],
      2,
      { lat: 0, lng: 0 },
      fixedNow,
    );
    const normal = calculateTrackingEta(base, 2, { lat: 0, lng: 0 }, fixedNow);
    assert.equal(delayed.etaAt!.getTime() - normal.etaAt!.getTime(), 20 * 60_000);
  });

  test("clamps early ETAs to the start of the delivery window and flags ETAs past its end", () => {
    const etaBeforeWindow = new Date("2026-10-08T10:42:00.000Z");
    const windowStart = new Date("2026-10-08T11:00:00.000Z");
    const range = makeEtaRange(etaBeforeWindow, 15, windowStart);
    assert.deepEqual(range, {
      from: "2026-10-08T11:00:00.000Z",
      to: "2026-10-08T11:15:00.000Z",
    });

    const windowEnd = new Date("2026-10-08T13:00:00.000Z");
    assert.deepEqual(
      calculateTrackingDelay(new Date("2026-10-08T13:20:00.000Z"), windowEnd, fixedNow),
      { delayed: true, delayMinutes: 0 },
    );
    assert.deepEqual(
      calculateTrackingDelay(
        new Date("2026-10-08T13:20:00.000Z"),
        windowEnd,
        new Date("2026-10-08T13:12:00.000Z"),
      ),
      { delayed: true, delayMinutes: 12 },
    );
    assert.deepEqual(
      calculateTrackingDelay(new Date("2026-10-08T12:50:00.000Z"), windowEnd, fixedNow),
      { delayed: false, delayMinutes: 0 },
    );
  });
});
