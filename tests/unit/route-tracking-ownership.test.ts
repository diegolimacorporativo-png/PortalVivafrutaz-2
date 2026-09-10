import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../server/database/db";
import { LogisticsController } from "../../server/modules/logistics/logistics.controller";
import { LogisticsService } from "../../server/modules/logistics/logistics.service";
import { createPublicTrackingToken } from "../../server/core/security/publicTrackingToken";

type Actor = {
  id: number;
  role: string;
  empresaId?: number | null;
};

function makeResponse() {
  return {
    statusCode: 200,
    payload: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: any) {
      this.payload = value;
      return this;
    },
  };
}

function makeController(options: {
  actor?: Actor | null;
  ownedRoute?: any;
  globalRoute?: any;
} = {}) {
  const calls: Record<string, any[]> = {};
  const track = (name: string, value: any) => async (...args: any[]) => {
    (calls[name] ||= []).push(args);
    return typeof value === "function" ? value(...args) : value;
  };
  const repo: any = {
    _calls: calls,
    getUser: track("getUser", options.actor ?? null),
    getRouteForCompany: track("getRouteForCompany", options.ownedRoute),
    getRoute: track("getRoute", options.globalRoute),
    getDrivers: track("getDrivers", []),
  };
  return { controller: new LogisticsController(new LogisticsService(repo)), repo };
}

async function callTracking(
  controller: LogisticsController,
  token: string,
  session?: Actor,
  extra: Record<string, any> = {},
) {
  const req: any = {
    params: { token },
    session: session ? { userId: session.id } : {},
    query: extra.query ?? {},
    body: extra.body ?? {},
    headers: extra.headers ?? {},
    requestId: "route-tracking-test",
  };
  const res = makeResponse();
  await controller.routeTracking(req, res as any);
  return res;
}

async function withTrackingDb<T>(
  implementation: (...args: any[]) => Promise<any>,
  callback: () => Promise<T>,
): Promise<{ result: T; calls: number }> {
  const database = db as any;
  const original = database.execute;
  let calls = 0;
  database.execute = async (...args: any[]) => {
    calls++;
    return implementation(...args);
  };
  try {
    return { result: await callback(), calls };
  } finally {
    database.execute = original;
  }
}

const routeRow = {
  id: 10,
  driver_id: null,
  vehicle_id: null,
  status: "planned",
  delivery_date: "2026-09-10",
  route_name: "Rota A",
  driver_name: null,
  driver_phone: null,
};

describe("authenticated numeric route tracking ownership", () => {
  test("anonymous numeric access is blocked before any database query", async () => {
    const { controller } = makeController();
    const { result, calls } = await withTrackingDb(
      async () => [routeRow],
      () => callTracking(controller, "10"),
    );
    assert.equal(result.statusCode, 403);
    assert.equal(calls, 0);
  });

  test("tenant user can access an owned route", async () => {
    const actor = { id: 1, role: "LOGISTICS", empresaId: 1 };
    const { controller, repo } = makeController({
      actor,
      ownedRoute: { id: 10, empresaId: 1 },
    });
    const { result } = await withTrackingDb(
      async () => [routeRow],
      () => callTracking(controller, "10", actor),
    );
    assert.equal(result.statusCode, 200);
    assert.deepEqual(repo._calls.getRouteForCompany, [[10, 1]]);
  });

  test("tenant user is blocked before detail queries for another company's route", async () => {
    const actor = { id: 1, role: "ADMIN", empresaId: 1 };
    const { controller, repo } = makeController({ actor, ownedRoute: undefined });
    const { result, calls } = await withTrackingDb(
      async () => [routeRow],
      () =>
        callTracking(controller, "10", actor, {
          query: { empresaId: "2", companyId: "2", tenantId: "2" },
          body: { empresaId: 2, companyId: 2, tenantId: 2 },
          headers: { "x-tenant-id": "2" },
        }),
    );
    assert.equal(result.statusCode, 404);
    assert.equal(calls, 0);
    assert.deepEqual(repo._calls.getRouteForCompany, [[10, 1]]);
  });

  test("driver is blocked before detail queries for another company's route", async () => {
    const actor = { id: 2, role: "MOTORISTA", empresaId: 1 };
    const { controller } = makeController({ actor, ownedRoute: undefined });
    const { result, calls } = await withTrackingDb(
      async () => [routeRow],
      () => callTracking(controller, "10", actor),
    );
    assert.equal(result.statusCode, 404);
    assert.equal(calls, 0);
  });

  test("MASTER and DIRECTOR retain global numeric access", async () => {
    for (const role of ["MASTER", "DIRECTOR"]) {
      const actor = { id: 3, role, empresaId: null };
      const { controller, repo } = makeController({
        actor,
        globalRoute: { id: 10, empresaId: 2 },
      });
      const { result } = await withTrackingDb(
        async () => [routeRow],
        () => callTracking(controller, "10", actor),
      );
      assert.equal(result.statusCode, 200, role);
      assert.deepEqual(repo._calls.getRoute, [[10]], role);
    }
  });

  test("missing numeric route remains not found", async () => {
    const actor = { id: 1, role: "LOGISTICS", empresaId: 1 };
    const { controller } = makeController({ actor, ownedRoute: undefined });
    const { result, calls } = await withTrackingDb(
      async () => [routeRow],
      () => callTracking(controller, "999", actor),
    );
    assert.equal(result.statusCode, 404);
    assert.equal(calls, 0);
  });
});

describe("public route tracking token compatibility", () => {
  test("valid route token still uses the public tracking flow", async () => {
    const issued = createPublicTrackingToken("route", 10);
    const { controller, repo } = makeController();
    const { result, calls } = await withTrackingDb(
      async () => [routeRow],
      () => callTracking(controller, issued.token),
    );
    assert.equal(result.statusCode, 200);
    assert.equal(repo._calls.getRoute, undefined);
    assert.equal(repo._calls.getRouteForCompany, undefined);
    assert.ok(calls >= 3);
  });

  test("tampered route token is rejected before any database query", async () => {
    const issued = createPublicTrackingToken("route", 10);
    const { controller } = makeController();
    const { result, calls } = await withTrackingDb(
      async () => [routeRow],
      () => callTracking(controller, `${issued.token}tampered`),
    );
    assert.equal(result.statusCode, 403);
    assert.equal(calls, 0);
  });
});
