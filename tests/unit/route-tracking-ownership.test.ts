import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolveNumericRouteTrackingAccess,
} from "../../server/modules/logistics/route-tracking.access";

describe("numeric route tracking ownership", () => {
  test("keeps a tenant-bound internal actor inside its own company", () => {
    assert.deepEqual(
      resolveNumericRouteTrackingAccess({
        id: 10,
        role: "ADMIN",
        empresaId: 42,
      }),
      { global: false, empresaId: 42 },
    );
  });

  test("does not authorize an unbound non-global internal actor", () => {
    assert.equal(
      resolveNumericRouteTrackingAccess({
        id: 10,
        role: "ADMIN",
        empresaId: null,
      }),
      null,
    );
  });

  test("allows only explicitly global MASTER/DIRECTOR actors without a tenant", () => {
    assert.deepEqual(
      resolveNumericRouteTrackingAccess({
        id: 1,
        role: "MASTER",
        empresaId: null,
      }),
      { global: true, empresaId: null },
    );
    assert.deepEqual(
      resolveNumericRouteTrackingAccess({
        id: 2,
        role: "DIRECTOR",
        empresaId: undefined,
      }),
      { global: true, empresaId: null },
    );
  });

  test("does not make a driver account global", () => {
    assert.equal(
      resolveNumericRouteTrackingAccess({
        id: 20,
        role: "MOTORISTA",
        empresaId: null,
      }),
      null,
    );
  });

  test("rejects client sessions from the numeric compatibility path", () => {
    assert.equal(
      resolveNumericRouteTrackingAccess({
        id: 30,
        role: "CLIENT",
        empresaId: 42,
      }),
      null,
    );
  });
});
