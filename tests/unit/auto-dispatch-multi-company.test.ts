import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  deliveryIsEligibleForAutoDispatch,
  eligibleRoutesForDelivery,
  nextGlobalRoutePosition,
  normalizeRouteCompanyIds,
  routeAuthorizesCompany,
} from "../../server/modules/logistics/auto-dispatch.policy";
import { assertActiveDeliveriesMatchRouteScope } from "../../server/modules/logistics/route-scope.policy";

describe("auto-dispatch multi-company policy", () => {
  const multiCompanyRoute = {
    id: 1,
    driverId: 7,
    deliveryDate: "2026-11-12",
    status: "SCHEDULED",
    companyIds: [10, 20, 30],
  };

  test("one route can receive 15, 8 and 12 authorized company deliveries with one global sequence", () => {
    const companyCounts = new Map([[10, 15], [20, 8], [30, 12]]);
    const assigned: Array<{ companyId: number; routeId: number; driverId: number; position: number }> = [];

    for (const [companyId, count] of companyCounts) {
      for (let index = 0; index < count; index++) {
        const routes = eligibleRoutesForDelivery([multiCompanyRoute], {
          companyId,
          deliveryDate: "2026-11-12",
        });
        assert.equal(routes.length, 1);
        const position = nextGlobalRoutePosition(assigned.map((row) => row.position));
        assigned.push({ companyId, routeId: routes[0].id, driverId: routes[0].driverId, position });
      }
    }

    assert.equal(assigned.length, 35);
    assert.deepEqual(new Set(assigned.map((row) => row.routeId)), new Set([1]));
    assert.deepEqual(new Set(assigned.map((row) => row.driverId)), new Set([7]));
    assert.deepEqual([...new Set(assigned.map((row) => row.companyId))].sort(), [10, 20, 30]);
    assert.deepEqual(assigned.map((row) => row.position), Array.from({ length: 35 }, (_, i) => i));
  });

  test("company outside company_ids cannot use the route", () => {
    assert.equal(routeAuthorizesCompany(multiCompanyRoute.companyIds, 40), false);
    assert.deepEqual(eligibleRoutesForDelivery([multiCompanyRoute], {
      companyId: 40,
      deliveryDate: "2026-11-12",
    }), []);
  });

  test("cancelled, already routed, companyless, date-less, or coordinate-less deliveries are not dispatchable", () => {
    const eligible = {
      status: "pendente",
      routeId: null,
      companyId: 10,
      deliveryDate: "2026-11-12",
      hasCoordinates: true,
    };
    assert.equal(deliveryIsEligibleForAutoDispatch(eligible), true);
    assert.equal(deliveryIsEligibleForAutoDispatch({ ...eligible, status: "cancelado" }), false);
    assert.equal(deliveryIsEligibleForAutoDispatch({ ...eligible, routeId: 55 }), false);
    assert.equal(deliveryIsEligibleForAutoDispatch({ ...eligible, companyId: null }), false);
    assert.equal(deliveryIsEligibleForAutoDispatch({ ...eligible, deliveryDate: null }), false);
    assert.equal(deliveryIsEligibleForAutoDispatch({ ...eligible, hasCoordinates: false }), false);
  });

  test("route eligibility rejects date mismatch, inactive status, and missing driver", () => {
    assert.deepEqual(eligibleRoutesForDelivery([multiCompanyRoute], {
      companyId: 20,
      deliveryDate: "2026-11-13",
    }), []);
    assert.deepEqual(eligibleRoutesForDelivery([{ ...multiCompanyRoute, status: "COMPLETED" }], {
      companyId: 20,
      deliveryDate: "2026-11-12",
    }), []);
    assert.deepEqual(eligibleRoutesForDelivery([{ ...multiCompanyRoute, driverId: 0 }], {
      companyId: 20,
      deliveryDate: "2026-11-12",
    }), []);
  });

  test("normalizes persisted JSON IDs and appends after all existing company positions", () => {
    assert.deepEqual(normalizeRouteCompanyIds("[10,20,20,0,\"bad\"]"), [10, 20]);
    assert.equal(nextGlobalRoutePosition([0, "4", 2]), 5);
    assert.equal(nextGlobalRoutePosition([]), 0);
    assert.equal(nextGlobalRoutePosition([0, null]), null);
    assert.equal(nextGlobalRoutePosition([0, 0]), null);
  });

  test("route scope edit preserves active linked deliveries and rejects removal or mismatch", () => {
    const linked = [
      { id: 101, companyId: 10, driverId: 7, deliveryDate: "2026-11-12" },
      { id: 202, companyId: 20, driverId: 7, deliveryDate: "2026-11-12" },
    ];
    assert.doesNotThrow(() => assertActiveDeliveriesMatchRouteScope({
      deliveries: linked,
      companyIds: [10, 20, 30],
      driverId: 7,
      deliveryDate: "2026-11-12",
    }));
    assert.throws(() => assertActiveDeliveriesMatchRouteScope({
      deliveries: linked,
      companyIds: [10, 30],
      driverId: 7,
      deliveryDate: "2026-11-12",
    }), /entregas ativas incompatíveis/);
    assert.throws(() => assertActiveDeliveriesMatchRouteScope({
      deliveries: linked,
      companyIds: [10, 20],
      driverId: 8,
      deliveryDate: "2026-11-12",
    }), /entregas ativas incompatíveis/);
    assert.throws(() => assertActiveDeliveriesMatchRouteScope({
      deliveries: linked,
      companyIds: [10, 20],
      driverId: 7,
      deliveryDate: "2026-11-13",
    }), /entregas ativas incompatíveis/);
  });
});
