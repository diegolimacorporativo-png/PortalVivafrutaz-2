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
    getRouteStops: track("getRouteStops", () => []),
    createRouteStop: track("createRouteStop", (d: any) => ({ id: 1, ...d })),
    updateRouteStop: track("updateRouteStop", (id: number, d: any) => ({ id, ...d })),
    deleteRouteStop: track("deleteRouteStop", () => undefined),
    getLogisticsAuditLogs: track("getLogisticsAuditLogs", () => []),
    getCompanies: track("getCompanies", () => []),
    getOrders: track("getOrders", () => []),
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
  app.get("/api/logistics/best-driver", controller.bestDriver);

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
      getDrivers: async () => [{ id: 1, name: "X", active: false }],
    });
    const app = makeApp(repo);
    const { status, body } = await call(app, "GET", "/api/logistics/best-driver");
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
});
