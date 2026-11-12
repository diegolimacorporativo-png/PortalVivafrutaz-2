import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  areAllRouteDeliveriesTerminal,
  isDeliveryVisibleOnDriverRoute,
  sortDriverRouteDeliveries,
  type DriverRouteDeliveryScope,
  type DriverRouteScope,
} from "../../server/modules/logistics/driver-route.policy";

describe("driver route multi-company visibility", () => {
  const route: DriverRouteScope = {
    id: 77,
    driverId: 9,
    deliveryDate: "2026-11-12",
    status: "SCHEDULED",
    companyIds: [10, 20, 30],
  };
  const delivery: DriverRouteDeliveryScope = {
    id: 101,
    routeId: 77,
    driverId: 9,
    companyId: 10,
    deliveryDate: "2026-11-12",
    status: "pendente",
    routePosition: 1,
  };

  test("returns 15, 8 and 12 deliveries across authorized companies in one global order", () => {
    const deliveries: DriverRouteDeliveryScope[] = [];
    const counts = new Map([[10, 15], [20, 8], [30, 12]]);
    for (const [companyId, count] of counts) {
      for (let index = 0; index < count; index++) {
        deliveries.push({ ...delivery, id: deliveries.length + 1, companyId, routePosition: deliveries.length + 1 });
      }
    }
    const visible = sortDriverRouteDeliveries(deliveries.filter((item) =>
      isDeliveryVisibleOnDriverRoute(route, item, 9),
    ));
    assert.equal(visible.length, 35);
    assert.equal(new Set(visible.map((item) => item.routeId)).size, 1);
    assert.deepEqual(visible.map((item) => item.routePosition), Array.from({ length: 35 }, (_, index) => index + 1));
    assert.deepEqual([...new Set(visible.map((item) => item.companyId))].sort(), [10, 20, 30]);
  });

  test("a different driver cannot see this route", () => {
    assert.equal(isDeliveryVisibleOnDriverRoute(route, delivery, 42), false);
  });

  test("rejects a delivery linked to a different route even when its driver matches", () => {
    assert.equal(isDeliveryVisibleOnDriverRoute(route, { ...delivery, routeId: 88 }, 9), false);
  });

  test("rejects a company outside company_ids and a delivery without effective company", () => {
    assert.equal(isDeliveryVisibleOnDriverRoute(route, { ...delivery, companyId: 40 }, 9), false);
    assert.equal(isDeliveryVisibleOnDriverRoute(route, { ...delivery, companyId: null }, 9), false);
  });

  test("rejects driver mismatch, route cancellation, canceled deliveries and date mismatch", () => {
    assert.equal(isDeliveryVisibleOnDriverRoute(route, { ...delivery, driverId: 12 }, 9), false);
    assert.equal(isDeliveryVisibleOnDriverRoute({ ...route, status: "CANCELLED" }, delivery, 9), false);
    assert.equal(isDeliveryVisibleOnDriverRoute(route, { ...delivery, status: "cancelado" }, 9), false);
    assert.equal(isDeliveryVisibleOnDriverRoute(route, { ...delivery, deliveryDate: "2026-11-13" }, 9), false);
  });

  test("supports legacy single-company route and sorts missing positions last without inventing positions", () => {
    const singleCompanyRoute = { ...route, companyIds: [10] };
    assert.equal(isDeliveryVisibleOnDriverRoute(singleCompanyRoute, delivery, 9), true);
    const sorted = sortDriverRouteDeliveries([
      { id: 3, routePosition: null },
      { id: 2, routePosition: 2 },
      { id: 1, routePosition: 1 },
    ]);
    assert.deepEqual(sorted.map((item) => item.id), [1, 2, 3]);
    assert.equal(sorted[2].routePosition, null);
  });

  test("route closure requires at least one delivery and all deliveries terminal", () => {
    assert.equal(areAllRouteDeliveriesTerminal([]), false);
    assert.equal(areAllRouteDeliveriesTerminal([{ status: "entregue" }, { status: "cancelado" }]), true);
    assert.equal(areAllRouteDeliveriesTerminal([{ status: "entregue" }, { status: "pendente" }]), false);
    assert.equal(areAllRouteDeliveriesTerminal([{ status: "cancelled" }, { status: "em_rota" }]), false);
  });
});
