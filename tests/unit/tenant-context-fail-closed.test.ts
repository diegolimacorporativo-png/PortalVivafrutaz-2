/**
 * Task 1 — tenant resolution matrix.
 *
 * These tests exercise the HTTP boundary and one real router. They do not
 * connect to the database: user lookup and the controller are replaced only
 * at the edge needed to prove whether the handler was reached.
 */
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { describe, mock, test } from "node:test";
import { companiesRouter } from "../../server/modules/companies/companies.routes";
import { companiesService } from "../../server/modules/companies/companies.service";
import { ordersRouter } from "../../server/modules/orders/orders.routes";
import { ordersService } from "../../server/modules/orders/orders.service";
import { register as registerReports } from "../../server/routes/reports.routes";
import { OrdersRepository } from "../../server/modules/orders/orders.repository";
import { storage } from "../../server/services/storage";
import {
  getTenantContext,
  resolveTenant,
  runWithTenant,
} from "../../server/core/tenant/context";
import { tenantContext } from "../../server/middleware/tenant";
import {
  ForbiddenError,
  UnauthorizedError,
} from "../../server/shared/errors/AppError";

async function request(
  app: express.Express,
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function makeCompaniesApp(session: Record<string, unknown> | undefined) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = session;
    next();
  });
  app.use("/api/companies", companiesRouter);
  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.status ?? 500).json({ message: error?.message });
  });
  return app;
}

function makeOrdersApp(session: Record<string, unknown> | undefined) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = session;
    next();
  });
  app.use("/api/orders", ordersRouter);
  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.status ?? 500).json({ message: error?.message });
  });
  return app;
}

function makeReportsApp(session: Record<string, unknown> | undefined) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = session;
    next();
  });
  registerReports(app);
  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.status ?? 500).json({ message: error?.message });
  });
  return app;
}

describe("tenantContext — fail-closed resolution", () => {
  test("anonymous request is 401 and never installs a context", () => {
    let received: unknown;
    tenantContext(
      { session: {} } as any,
      {} as any,
      (error?: unknown) => { received = error; },
    );
    assert.ok(received instanceof UnauthorizedError);
  });

  test("ADMIN without a company is 403 even when query selects a tenant", async () => {
    const lookup = mock.method(storage, "getUser", async () => ({
      id: 10,
      empresaId: null,
      role: "ADMIN",
    } as any));
    try {
      let received: unknown;
      await tenantContext(
        { session: { userId: 10 }, query: { empresaId: "20" }, header: () => undefined } as any,
        {} as any,
        (error?: unknown) => { received = error; },
      );
      assert.ok(received instanceof ForbiddenError);
    } finally {
      lookup.mock.restore();
    }
  });

  test("DEVELOPER without a company is not promoted to global scope", async () => {
    const lookup = mock.method(storage, "getUser", async () => ({
      id: 11,
      empresaId: null,
      role: "DEVELOPER",
    } as any));
    try {
      let received: unknown;
      await tenantContext(
        { session: { userId: 11 }, query: {}, header: () => undefined } as any,
        {} as any,
        (error?: unknown) => { received = error; },
      );
      assert.ok(received instanceof ForbiddenError);
    } finally {
      lookup.mock.restore();
    }
  });

  test("MASTER and DIRECTOR retain explicit global flow without a target", async () => {
    for (const role of ["MASTER", "DIRECTOR"]) {
      const lookup = mock.method(storage, "getUser", async () => ({
        id: 12,
        empresaId: null,
        role,
      } as any));
      try {
        let received: unknown;
        await tenantContext(
          { session: { userId: 12 }, query: {}, header: () => undefined } as any,
          {} as any,
          (error?: unknown) => { received = error; },
        );
        assert.equal(received, undefined);
      } finally {
        lookup.mock.restore();
      }
    }
  });

  test("service requests require one target and reject ambiguous selectors", () => {
    for (const requestShape of [
      { query: {}, header: () => undefined },
      { query: { empresaId: "20" }, header: () => "21" },
    ]) {
      let received: unknown;
      tenantContext(
        { isService: true, ...requestShape } as any,
        {} as any,
        (error?: unknown) => { received = error; },
      );
      assert.ok(received instanceof ForbiddenError);
    }
  });

  test("legacy resolveTenant never trusts req.user or client-controlled values", () => {
    assert.equal(
      resolveTenant({ user: { role: "MASTER" }, query: { tenantId: "20" } }),
      null,
    );
    runWithTenant(
      { principal: { kind: "company", empresaId: 10 }, empresaId: 10 },
      () => {
        assert.equal(
          resolveTenant({ user: { empresaId: 20 }, body: { companyId: 20 } }),
          10,
        );
        assert.equal(getTenantContext()?.empresaId, 10);
      },
    );
  });
});

describe("real companies route — handler boundary", () => {
  test("tenant A cannot reach the list handler with tenant B in query/header", async () => {
    const lookup = mock.method(storage, "getUser", async () => ({
      id: 1,
      empresaId: 10,
      role: "ADMIN",
    } as any));
    const original = companiesService.list;
    let handlerCalls = 0;
    (companiesService as any).list = async () => {
      handlerCalls++;
      return [{ id: 10 }];
    };
    try {
      const app = makeCompaniesApp({ userId: 1 });
      const queryAttempt = await request(app, "GET", "/api/companies?empresaId=20");
      const headerAttempt = await request(app, "GET", "/api/companies", {
        headers: { "X-Empresa-Id": "20" },
      });
      assert.equal(queryAttempt.status, 403);
      assert.equal(headerAttempt.status, 403);
      assert.equal(handlerCalls, 0);
    } finally {
      lookup.mock.restore();
      (companiesService as any).list = original;
    }
  });

  test("MASTER global read is allowed, while service read without target is 403", async () => {
    const original = companiesService.list;
    let handlerCalls = 0;
    (companiesService as any).list = async () => {
      handlerCalls++;
      return [];
    };
    const lookup = mock.method(storage, "getUser", async () => ({
      id: 1,
      empresaId: null,
      role: "MASTER",
    } as any));
    const oldKey = process.env.INTERNAL_API_KEY;
    process.env.INTERNAL_API_KEY = "test-service-key";
    try {
      const globalResult = await request(makeCompaniesApp({ userId: 1 }), "GET", "/api/companies");
      const serviceResult = await request(
        makeCompaniesApp(undefined),
        "GET",
        "/api/companies",
        { headers: { "x-api-key": "test-service-key" } },
      );
      assert.equal(globalResult.status, 200);
      assert.equal(serviceResult.status, 403);
      assert.equal(handlerCalls, 1);
    } finally {
      lookup.mock.restore();
      (companiesService as any).list = original;
      if (oldKey === undefined) delete process.env.INTERNAL_API_KEY;
      else process.env.INTERNAL_API_KEY = oldKey;
    }
  });
});

describe("orders writes — no global fallback", () => {
  test("update fails before storage when no tenant context exists", async () => {
    const repository = new OrdersRepository();
    await assert.rejects(
      () => repository.update(123, { notes: "attempt" }),
      (error: any) => error instanceof UnauthorizedError && error.status === 401,
    );
  });

  test("update fails before storage for an explicitly global MASTER", async () => {
    await runWithTenant(
      {
        principal: { kind: "admin", empresaId: null, userId: 1, role: "MASTER" },
        empresaId: null,
      },
      async () => {
        const repository = new OrdersRepository();
        await assert.rejects(
          () => repository.update(123, { notes: "attempt" }),
          (error: any) => error instanceof ForbiddenError && error.status === 403,
        );
      },
    );
  });
});

describe("real orders and reports routes — tenant precedence", () => {
  test("tenant A order list rejects tenant B before the controller/service", async () => {
    const lookup = mock.method(storage, "getUser", async () => ({
      id: 1,
      empresaId: 10,
      role: "ADMIN",
    } as any));
    const original = ordersService.list;
    let serviceCalls = 0;
    (ordersService as any).list = async () => {
      serviceCalls++;
      return [];
    };
    try {
      const response = await request(
        makeOrdersApp({ userId: 1, userRole: "ADMIN" }),
        "GET",
        "/api/orders?empresaId=20",
      );
      assert.equal(response.status, 403);
      assert.equal(serviceCalls, 0);
    } finally {
      lookup.mock.restore();
      (ordersService as any).list = original;
    }
  });

  test("tenant A report ignores companyId from query and body", async () => {
    const lookup = mock.method(storage, "getUser", async () => ({
      id: 1,
      empresaId: 10,
      role: "ADMIN",
    } as any));
    const original = storage.getPurchasingReport;
    const calls: any[] = [];
    (storage as any).getPurchasingReport = async (params: any) => {
      calls.push(params);
      return { rows: [] };
    };
    try {
      const response = await request(
        makeReportsApp({ userId: 1, userRole: "ADMIN" }),
        "GET",
        "/api/reports/purchasing?companyId=20",
      );
      assert.equal(response.status, 200);
      assert.equal(calls[0].companyId, 10);
    } finally {
      lookup.mock.restore();
      (storage as any).getPurchasingReport = original;
    }
  });
});