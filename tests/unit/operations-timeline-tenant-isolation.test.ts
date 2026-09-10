import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { afterEach, describe, mock, test } from "node:test";
import { db } from "../../server/database/db";
import { register as registerOperations } from "../../server/routes/operations.routes";
import { storage } from "../../server/services/storage";

type Session = Record<string, unknown> | undefined;

const orderA = {
  id: 101,
  orderCode: "PED-A-101",
  companyId: 10,
  status: "CONFIRMED",
  workflowStatus: "APPROVED",
  fiscalStatus: null,
  createdAt: new Date("2026-01-01T10:00:00.000Z"),
  deliveryDate: null,
  totalValue: "100.00",
  weekReference: "2026-W01",
};

const orderB = { ...orderA, id: 202, orderCode: "PED-B-202", companyId: 20 };

async function request(
  app: express.Express,
  path: string,
  options: { session?: Session; body?: unknown; headers?: Record<string, string> } = {},
) {
  app.locals.testSession = options.session;
  app.locals.testBody = options.body;
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: "GET",
    headers: {
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = app.locals.testSession;
    if (app.locals.testBody !== undefined) (req as any).body = app.locals.testBody;
    next();
  });
  registerOperations(app);
  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.status ?? 500).json({ message: error?.message });
  });
  return app;
}

function mockDatabase(orderRows: unknown[]) {
  let selectCalls = 0;
  let detailedQueryCalls = 0;
  const select = mock.method(db, "select", () => {
    selectCalls += 1;
    const isOrderQuery = selectCalls === 1;
    if (!isOrderQuery) detailedQueryCalls += 1;
    const rows = isOrderQuery ? orderRows : [];
    const builder: any = {
      from: () => builder,
      where: () => builder,
      limit: async () => rows,
      orderBy: async () => rows,
    };
    return builder;
  });
  return {
    select,
    counts: () => ({ selectCalls, detailedQueryCalls }),
  };
}

function mockTenantUser(user: { id: number; empresaId: number | null; role: string }) {
  return mock.method(storage, "getUser", async () => user as any);
}

afterEach(() => {
  mock.restoreAll();
});

describe("operations timeline — tenant isolation", () => {
  test("tenant A accesses its own timeline", async () => {
    const user = mockTenantUser({ id: 1, empresaId: 10, role: "ADMIN" });
    const database = mockDatabase([orderA]);
    try {
      const response = await request(makeApp(), "/api/admin/operations/timeline/101", {
        session: { userId: 1, userRole: "ADMIN" },
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.data.order.companyId, 10);
      assert.equal(database.counts().detailedQueryCalls, 6);
    } finally {
      user.mock.restore();
      database.select.mock.restore();
    }
  });

  test("tenant A cannot access tenant B by resource ID and details are not queried", async () => {
    const user = mockTenantUser({ id: 1, empresaId: 10, role: "ADMIN" });
    const database = mockDatabase([]);
    try {
      const response = await request(makeApp(), "/api/admin/operations/timeline/202", {
        session: { userId: 1, userRole: "ADMIN" },
      });
      assert.equal(response.status, 404);
      assert.equal(response.body.data, undefined);
      assert.equal(database.counts().selectCalls, 1);
      assert.equal(database.counts().detailedQueryCalls, 0);
    } finally {
      user.mock.restore();
      database.select.mock.restore();
    }
  });

  test("tenant A cannot replace its tenant through query, header, or body", async () => {
    const user = mockTenantUser({ id: 1, empresaId: 10, role: "ADMIN" });
    const database = mockDatabase([]);
    try {
      const queryResponse = await request(makeApp(), "/api/admin/operations/timeline/202?empresaId=20", {
        session: { userId: 1, userRole: "ADMIN" },
      });
      assert.equal(queryResponse.status, 403);

      const headerResponse = await request(makeApp(), "/api/admin/operations/timeline/202", {
        session: { userId: 1, userRole: "ADMIN" },
        headers: { "X-Empresa-Id": "20" },
      });
      assert.equal(headerResponse.status, 403);

      const bodyResponse = await request(makeApp(), "/api/admin/operations/timeline/202", {
        session: { userId: 1, userRole: "ADMIN" },
        body: { empresaId: 20, companyId: 20, tenantId: 20 },
      });
      assert.equal(bodyResponse.status, 404);
      assert.equal(database.counts().detailedQueryCalls, 0);
    } finally {
      user.mock.restore();
      database.select.mock.restore();
    }
  });

  test("anonymous request is 401 and never reaches the database", async () => {
    const database = mockDatabase([orderA]);
    try {
      const response = await request(makeApp(), "/api/admin/operations/timeline/101", {
        session: undefined,
      });
      assert.equal(response.status, 401);
      assert.equal(database.counts().selectCalls, 0);
    } finally {
      database.select.mock.restore();
    }
  });

  test("user without a tenant and outside global policy is blocked", async () => {
    const user = mockTenantUser({ id: 2, empresaId: null, role: "ADMIN" });
    const database = mockDatabase([orderA]);
    try {
      const response = await request(makeApp(), "/api/admin/operations/timeline/101", {
        session: { userId: 2, userRole: "ADMIN" },
      });
      assert.equal(response.status, 403);
      assert.equal(database.counts().selectCalls, 0);
    } finally {
      user.mock.restore();
      database.select.mock.restore();
    }
  });

  for (const role of ["MASTER", "DIRECTOR"]) {
    test(`${role} global flow remains available`, async () => {
      const user = mockTenantUser({ id: 3, empresaId: null, role });
      const database = mockDatabase([orderB]);
      try {
        const response = await request(makeApp(), "/api/admin/operations/timeline/202", {
          session: { userId: 3, userRole: role },
        });
        assert.equal(response.status, 200);
        assert.equal(response.body.data.order.companyId, 20);
        assert.equal(database.counts().detailedQueryCalls, 6);
      } finally {
        user.mock.restore();
        database.select.mock.restore();
      }
    });
  }
});