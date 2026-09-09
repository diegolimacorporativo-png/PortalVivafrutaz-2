/**
 * Unit tests for the logistics module.
 *
 * Why this lives in `tests/unit/` (not `server/modules/logistics/__tests__/`):
 * the project's `npm test` script runs `tsx --test tests/unit/*.test.ts`. We
 * prioritised "tests that actually run in CI" over the spec-suggested folder
 * name. Equivalent semantics; same Node built-in test runner.
 *
 * We drive the controller through a real Express app using a stub repository
 * so no database is required. Sessions are forged via a tiny middleware that
 * sets `req.session` from the `x-test-session` header.
 *
 * Run with:
 *   npx tsx --test tests/unit/logistics.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { LogisticsService } from "../../server/modules/logistics/logistics.service";
import { LogisticsController } from "../../server/modules/logistics/logistics.controller";

// ── Stub repository ────────────────────────────────────────────────────
function makeStubRepo(overrides: Record<string, any> = {}) {
  const calls: Record<string, any[]> = {};
  const track =
    (name: string, impl: (...args: any[]) => any) =>
    async (...args: any[]) => {
      (calls[name] ||= []).push(args);
      return impl(...args);
    };

  const repo: any = {
    _calls: calls,
    getDrivers: track("getDrivers", () => []),
    createDriver: track("createDriver", (d: any) => ({ id: 1, ...d })),
    updateDriver: track("updateDriver", (id: number, d: any) => ({ id, ...d })),
    deleteDriver: track("deleteDriver", () => undefined),
    getVehicles: track("getVehicles", () => []),
    createVehicle: track("createVehicle", (d: any) => ({ id: 1, ...d })),
    updateVehicle: track("updateVehicle", (id: number, d: any) => ({ id, ...d })),
    deleteVehicle: track("deleteVehicle", () => undefined),
    getRoutes: track("getRoutes", () => []),
    createRoute: track("createRoute", (d: any) => ({ id: 1, ...d })),
    updateRoute: track("updateRoute", (id: number, d: any) => ({ id, ...d })),
    deleteRoute: track("deleteRoute", () => undefined),
    getMaintenances: track("getMaintenances", () => []),
    createMaintenance: track("createMaintenance", (d: any) => ({ id: 1, ...d })),
    updateMaintenance: track("updateMaintenance", () => undefined),
    deleteMaintenance: track("deleteMaintenance", () => undefined),
    getRoute: track("getRoute", () => undefined),
    getRouteForCompany: track("getRouteForCompany", () => undefined),
    getRouteStops: track("getRouteStops", () => []),
    getRouteStopsForCompany: track("getRouteStopsForCompany", () => []),
    createRouteStopForRoute: track(
      "createRouteStopForRoute",
      (routeId: number, d: any, empresaId?: number) => ({
        id: 1,
        routeId,
        companyId: empresaId,
        ...d,
      }),
    ),
    updateRouteStopForRoute: track(
      "updateRouteStopForRoute",
      (stopId: number, routeId: number, d: any) => ({
        id: stopId,
        routeId,
        ...d,
      }),
    ),
    deleteRouteStopForRoute: track("deleteRouteStopForRoute", () => true),
    getLogisticsAuditLogs: track("getLogisticsAuditLogs", () => []),
    getCompany: track("getCompany", () => undefined),
    getCompanies: track("getCompanies", () => []),
    getOrders: track("getOrders", () => []),
    getOrdersSafe: track("getOrdersSafe", () => []),
    getDriversSafe: track("getDriversSafe", () => []),
    getRoutesSafe: track("getRoutesSafe", () => []),
    getDeliveries: track("getDeliveries", () => []),
    getUser: track("getUser", () => null),
    log: track("log", () => undefined),
    ...overrides,
  };
  return repo;
}

function makeApp(repo: any) {
  const service = new LogisticsService(repo);
  const controller = new LogisticsController(service);

  const app = express();
  app.use(express.json());
  // Forge session from header for tests
  app.use((req, _res, next) => {
    const raw = req.header("x-test-session");
    (req as any).session = raw ? JSON.parse(raw) : {};
    next();
  });

  // Wire only the endpoints we test
  app.get("/api/logistics/drivers", controller.listDrivers);
  app.post("/api/logistics/drivers", controller.createDriver);
  app.delete("/api/logistics/drivers/:id", controller.deleteDriver);
  app.post("/api/logistics/calculate-distance", controller.calculateDistance);
  app.get("/api/logistics/audit-logs", controller.auditLogs);
  app.get("/api/logistics/route-assistant", controller.routeAssistant);
  app.post("/api/logistics/suggest-route", controller.suggestRoute);
  app.get("/api/logistics/day-orders", controller.dayOrders);
  app.post("/api/logistics/simulate-day", controller.simulateDay);
  app.get("/api/logistics/reports/deliveries", controller.deliveriesReport);
  app.get("/api/logistics/best-driver", controller.bestDriver);
  app.get("/api/logistics/smart-search", controller.smartSearch);
  app.post("/api/logistics/route-insertion", controller.routeInsertion);
  app.get("/api/logistics/smart-route-plan", controller.smartRoutePlan);
  app.get("/api/logistics/routes/:routeId/stops", controller.listRouteStops);
  app.post("/api/logistics/routes/:routeId/stops", controller.createRouteStop);
  app.patch(
    "/api/logistics/routes/:routeId/stops/:stopId",
    controller.updateRouteStop,
  );
  app.delete(
    "/api/logistics/routes/:routeId/stops/:stopId",
    controller.deleteRouteStop,
  );

  return app;
}

function bootApp(app: express.Express): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        throw new Error("Failed to bind ephemeral port");
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((e) => (e ? rej(e) : res())),
          ),
      });
    });
  });
}

async function call(
  app: express.Express,
  method: string,
  path: string,
  opts: { body?: any; session?: any } = {},
): Promise<{ status: number; body: any }> {
  const { url, close } = await bootApp(app);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (opts.session !== undefined) {
      headers["x-test-session"] = JSON.stringify(opts.session);
    }
    const res = await fetch(`${url}${path}`, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {}
    return { status: res.status, body };
  } finally {
    await close();
  }
}

// ── Tests ──────────────────────────────────────────────────────────────
describe("logistics — auth gates", () => {
  test("GET /drivers without session → 401 'Not authenticated'", async () => {
    const repo = makeStubRepo();
    const app = makeApp(repo);
    const { status, body } = await call(app, "GET", "/api/logistics/drivers");
    assert.equal(status, 401);
    assert.equal(body.message, "Not authenticated");
    assert.equal(repo._calls.getDrivers, undefined);
  });

  test("GET /drivers with non-logistics role → 403 'Sem permissão'", async () => {
    const repo = makeStubRepo({
      getUser: async () => ({ id: 7, role: "CLIENT", email: "c@x" }),
    });
    const app = makeApp(repo);
    const { status, body } = await call(app, "GET", "/api/logistics/drivers", {
      session: { userId: 7 },
    });
    assert.equal(status, 403);
    assert.equal(body.message, "Sem permissão");
  });

  test("GET /drivers with LOGISTICS role → 200 + repo invoked", async () => {
    const drivers = [{ id: 1, name: "João" }];
    const repo = makeStubRepo({
      getUser: async () => ({ id: 7, role: "LOGISTICS", email: "j@x" }),
      getDrivers: async () => drivers,
    });
    const app = makeApp(repo);
    const { status, body } = await call(app, "GET", "/api/logistics/drivers", {
      session: { userId: 7 },
    });
    assert.equal(status, 200);
    assert.deepEqual(body, drivers);
  });

  test("GET /audit-logs gates with stricter LOGISTICS_ADMIN_ROLES", async () => {
    // OPERATIONS_MANAGER is allowed by logAuth but NOT by admin gate
    const repo = makeStubRepo({
      getUser: async () => ({
        id: 7,
        role: "OPERATIONS_MANAGER",
        email: "o@x",
      }),
    });
    const app = makeApp(repo);
    const { status, body } = await call(
      app,
      "GET",
      "/api/logistics/audit-logs",
      { session: { userId: 7 } },
    );
    assert.equal(status, 403);
    assert.equal(
      body.message,
      "Acesso negado. Apenas administradores logísticos.",
    );
  });
});

describe("logistics — validation parity with legacy", () => {
  test("POST /drivers without name → 400 'Nome obrigatório'", async () => {
    const repo = makeStubRepo({
      getUser: async () => ({ id: 1, role: "ADMIN", email: "a@x" }),
    });
    const app = makeApp(repo);
    const { status, body } = await call(app, "POST", "/api/logistics/drivers", {
      session: { userId: 1 },
      body: { phone: "9999" },
    });
    assert.equal(status, 400);
    assert.equal(body.message, "Nome obrigatório");
    // No write occurred
    assert.equal(repo._calls.createDriver, undefined);
    assert.equal(repo._calls.log, undefined);
  });

  test("POST /calculate-distance without coords → 400 (no auth required)", async () => {
    const repo = makeStubRepo();
    const app = makeApp(repo);
    const { status, body } = await call(
      app,
      "POST",
      "/api/logistics/calculate-distance",
      { body: { from: { lat: 0 }, to: {} } },
    );
    assert.equal(status, 400);
    assert.equal(body.message, "Informe from {lat, lng} e to {lat, lng}");
  });
});

describe("logistics — happy paths and edge cases", () => {
  test("POST /drivers creates + writes audit log with actor info", async () => {
    const repo = makeStubRepo({
      getUser: async () => ({ id: 9, role: "ADMIN", email: "a@x" }),
    });
    const app = makeApp(repo);
    const { status, body } = await call(app, "POST", "/api/logistics/drivers", {
      session: { userId: 9 },
      body: { name: "Maria" },
    });
    assert.equal(status, 200);
    assert.equal(body.name, "Maria");
    assert.equal(body.active, true);

    // Audit log was written with ACTOR fields, not generic ones
    const logCalls = repo._calls.log;
    assert.equal(logCalls.length, 1);
    const [logged] = logCalls[0];
    assert.equal(logged.action, "DRIVER_CREATED");
    assert.equal(logged.userId, 9);
    assert.equal(logged.userEmail, "a@x");
    assert.equal(logged.userRole, "ADMIN");
  });

  test("DELETE /drivers/:id returns { ok: true } shape (not 204)", async () => {
    const repo = makeStubRepo({
      getUser: async () => ({ id: 1, role: "ADMIN", email: "a@x" }),
    });
    const app = makeApp(repo);
    const { status, body } = await call(
      app,
      "DELETE",
      "/api/logistics/drivers/42",
      { session: { userId: 1 } },
    );
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(repo._calls.deleteDriver[0][0], 42);
  });

  test("GET /best-driver with no active drivers → { driver: null, message }", async () => {
    const repo = makeStubRepo({
      getUser: async () => ({ id: 1, role: "LOGISTICS", empresaId: 1 }),
      getDriversSafe: async () => [{ id: 1, name: "X", active: false }],
    });
    const app = makeApp(repo);
    const { status, body } = await call(app, "GET", "/api/logistics/best-driver", {
      session: { userId: 1 },
    });
    assert.equal(status, 200);
    assert.equal(body.driver, null);
    assert.equal(body.message, "Nenhum motorista ativo");
  });

  test("GET /route-assistant uses 'Não autorizado' (not 'Não autenticado')", async () => {
    const repo = makeStubRepo();
    const app = makeApp(repo);
    const { status, body } = await call(
      app,
      "GET",
      "/api/logistics/route-assistant",
    );
    assert.equal(status, 401);
    // Legacy quirk: this endpoint uses "Não autorizado", others use "Não autenticado".
    assert.equal(body.message, "Não autorizado");
  });

  test("GET /smart-search without session → 401", async () => {
    const repo = makeStubRepo();
    const app = makeApp(repo);
    const { status } = await call(app, "GET", "/api/logistics/smart-search?q=Cliente");
    assert.equal(status, 401);
    assert.equal(repo._calls.getCompanies, undefined);
  });

  test("POST /route-insertion rejects a non-logistics role → 403", async () => {
    const repo = makeStubRepo({
      getUser: async () => ({ id: 1, role: "CLIENT", empresaId: 1 }),
    });
    const app = makeApp(repo);
    const { status, body } = await call(
      app,
      "POST",
      "/api/logistics/route-insertion",
      { session: { userId: 1 }, body: { companyId: 2 } },
    );
    assert.equal(status, 403);
    assert.equal(body.message, "Sem permissão");
  });

  test("tenant-bound analytics fails closed for an unbound ADMIN → 403", async () => {
    const repo = makeStubRepo({
      getUser: async () => ({ id: 1, role: "ADMIN", empresaId: null }),
    });
    const app = makeApp(repo);
    const { status, body } = await call(
      app,
      "GET",
      "/api/logistics/smart-search?q=Cliente",
      { session: { userId: 1 } },
    );
    assert.equal(status, 403);
    assert.match(body.message, /empresa/i);
  });

  test("analytical endpoints require a session", async () => {
    const repo = makeStubRepo();
    const app = makeApp(repo);
    const requests: Array<[string, string, any]> = [
      ["POST", "/api/logistics/suggest-route", {}],
      ["GET", "/api/logistics/day-orders", undefined],
      ["POST", "/api/logistics/simulate-day", {}],
      ["GET", "/api/logistics/reports/deliveries", undefined],
      ["GET", "/api/logistics/best-driver", undefined],
      ["GET", "/api/logistics/smart-search?q=A", undefined],
      ["POST", "/api/logistics/route-insertion", {}],
      ["GET", "/api/logistics/smart-route-plan", undefined],
    ];

    for (const [method, path, body] of requests) {
      const response = await call(app, method, path, { body });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  });
});

describe("logistics — legacy route stops authorization and tenant isolation", () => {
  const tenantSession = { userId: 21 };

  test("all route-stop methods require an authenticated logistics role", async () => {
    const repo = makeStubRepo();
    const app = makeApp(repo);
    for (const [method, path, body] of [
      ["GET", "/api/logistics/routes/10/stops", undefined],
      ["POST", "/api/logistics/routes/10/stops", { cidade: "São Paulo" }],
      ["PATCH", "/api/logistics/routes/10/stops/3", { cidade: "São Paulo" }],
      ["DELETE", "/api/logistics/routes/10/stops/3", undefined],
    ] as const) {
      const response = await call(app, method, path, { body });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  });

  test("CLIENT and DRIVER cannot use the admin route-stop surface", async () => {
    for (const role of ["CLIENT", "DRIVER", "MOTORISTA"]) {
      const repo = makeStubRepo({
        getUser: async () => ({ id: 21, role, empresaId: 10 }),
      });
      const app = makeApp(repo);
      const response = await call(
        app,
        "GET",
        "/api/logistics/routes/10/stops",
        { session: tenantSession },
      );
      assert.equal(response.status, 403, role);
      assert.equal(repo._calls.getRouteForCompany, undefined, role);
    }
  });

  test("tenant-bound user lists only stops from an owned route", async () => {
    const stops = [{ id: 3, routeId: 10, companyId: 10, cidade: "Campinas" }];
    const repo = makeStubRepo({
      getUser: async () => ({ id: 21, role: "LOGISTICS", empresaId: 10 }),
      getRouteForCompany: async () => ({ id: 10, empresaId: 10, name: "Rota A" }),
      getRouteStopsForCompany: async () => stops,
    });
    const app = makeApp(repo);
    const response = await call(
      app,
      "GET",
      "/api/logistics/routes/10/stops",
      { session: tenantSession },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, stops);
    assert.equal(repo._calls.getRouteStops, undefined);
  });

  test("cross-tenant route is hidden on list, update and delete", async () => {
    for (const [method, path, body] of [
      ["GET", "/api/logistics/routes/99/stops", undefined],
      ["PATCH", "/api/logistics/routes/99/stops/3", { cidade: "spoof" }],
      ["DELETE", "/api/logistics/routes/99/stops/3", undefined],
    ] as const) {
      const repo = makeStubRepo({
        getUser: async () => ({ id: 21, role: "ADMIN", empresaId: 10 }),
        getRouteForCompany: async () => undefined,
      });
      const app = makeApp(repo);
      const response = await call(app, method, path, {
        session: tenantSession,
        body,
      });
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal(repo._calls.updateRouteStopForRoute, undefined);
      assert.equal(repo._calls.deleteRouteStopForRoute, undefined);
    }
  });

  test("create derives ownership from the route and ignores spoofed fields", async () => {
    const repo = makeStubRepo({
      getUser: async () => ({ id: 21, role: "ADMIN", empresaId: 10 }),
      getRouteForCompany: async () => ({ id: 10, empresaId: 10, name: "Rota A" }),
    });
    const app = makeApp(repo);
    const response = await call(
      app,
      "POST",
      "/api/logistics/routes/10/stops",
      {
        session: tenantSession,
        body: {
          cidade: "Campinas",
          latitude: -22.9,
          longitude: -47.1,
          routeId: 99,
          companyId: 999,
          empresaId: 999,
          createdAt: "2099-01-01T00:00:00.000Z",
        },
      },
    );
    assert.equal(response.status, 200);
    const [routeId, payload, empresaId] = repo._calls.createRouteStopForRoute[0];
    assert.equal(routeId, 10);
    assert.equal(empresaId, 10);
    assert.deepEqual(payload, {
      cidade: "Campinas",
      latitude: -22.9,
      longitude: -47.1,
    });
    assert.equal(payload.routeId, undefined);
    assert.equal(payload.companyId, undefined);
    assert.equal(payload.empresaId, undefined);
  });

  test("MASTER and DIRECTOR retain explicit global access", async () => {
    for (const role of ["MASTER", "DIRECTOR"]) {
      const repo = makeStubRepo({
        getUser: async () => ({ id: 1, role, empresaId: null }),
        getRoute: async () => ({ id: 10, empresaId: 20, name: "Rota global" }),
        getRouteStops: async () => [{ id: 3, routeId: 10 }],
      });
      const app = makeApp(repo);
      const response = await call(
        app,
        "GET",
        "/api/logistics/routes/10/stops",
        { session: { userId: 1 } },
      );
      assert.equal(response.status, 200, role);
      assert.deepEqual(response.body, [{ id: 3, routeId: 10 }]);
    }
  });
});
