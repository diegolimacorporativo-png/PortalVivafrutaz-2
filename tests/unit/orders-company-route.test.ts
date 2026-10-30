import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { mock, test } from "node:test";

process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

const { companiesRouter } = await import("../../server/modules/companies/companies.routes");
const { companyOrdersRouter } = await import("../../server/modules/orders/orders.routes");
const { ordersRepository } = await import("../../server/modules/orders/orders.repository");
const { storage } = await import("../../server/services/storage");

async function request(
  session: Record<string, unknown> | undefined,
  path: string,
  headers: Record<string, string> = {},
) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = session;
    next();
  });
  // Match production registration order: companies module then its orders
  // auxiliary route, followed by the legacy router (not needed in this test).
  app.use("/api/companies", companiesRouter);
  app.use("/api/companies", companyOrdersRouter);
  app.use((error: any, _req: any, res: any, _next: any) => {
    const status = error?.status ?? (error?.name === "ZodError" ? 400 : 500);
    res.status(status).json({ message: error?.message });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { headers });
  const text = await response.text();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test("company orders route preserves the client array response and tenant scope", async () => {
  let companyExists = true;
  const getCompany = mock.method(storage, "getCompany", async (id: number) => companyExists ? ({ id, active: true } as any) : null as any);
  const getCompanyOrders = mock.method(storage, "getCompanyOrders", async (id: number) => [{ id: 7, companyId: id } as any]);
  const getReceivables = mock.method(ordersRepository, "getAccountReceivablesByOrderIds", async () => ({}));
  try {
    const result = await request({ companyId: 20 }, "/api/companies/20/orders");
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, [{ id: 7, companyId: 20, isPaid: false, paidAt: null }]);
    assert.equal(getCompanyOrders.mock.calls.length, 1);

    const crossTenant = await request({ companyId: 20 }, "/api/companies/21/orders");
    assert.equal(crossTenant.status, 403);
    assert.equal(getCompanyOrders.mock.calls.length, 1);
  } finally {
    getReceivables.mock.restore();
    getCompanyOrders.mock.restore();
    getCompany.mock.restore();
  }
});

test("company orders route applies internal tab and action denials", async () => {
  let currentUser: any = {
    id: 10,
    active: true,
    role: "COMERCIAL",
    empresaId: null,
    tabPermissions: ["logistics"],
    permissions: { actionOverridesV1: { orders: { read: false } } },
  };
  const getUser = mock.method(storage, "getUser", async () => currentUser);
  const getCompanyOrders = mock.method(storage, "getCompanyOrders", async () => [{ id: 7 } as any]);
  try {
    const tabDenied = await request({ userId: 10 }, "/api/companies/20/orders");
    assert.equal(tabDenied.status, 403);

    currentUser = { ...currentUser, tabPermissions: ["orders"] };
    const actionDenied = await request({ userId: 10 }, "/api/companies/20/orders");
    assert.equal(actionDenied.status, 403);
    assert.equal(getCompanyOrders.mock.calls.length, 0);
  } finally {
    getCompanyOrders.mock.restore();
    getUser.mock.restore();
  }
});

test("internal multi-company reader can query an active target only after server-side validation", async () => {
  const getUser = mock.method(storage, "getUser", async () => ({
    id: 22, active: true, role: "COMERCIAL", empresaId: null,
    tabPermissions: ["orders"], permissions: null,
  } as any));
  let companyExists = true;
  const getCompany = mock.method(storage, "getCompany", async (id: number) => companyExists ? ({ id, active: true } as any) : null as any);
  const getCompanyOrders = mock.method(storage, "getCompanyOrders", async (id: number) => [{ id: 70, companyId: id } as any]);
  const getReceivables = mock.method(ordersRepository, "getAccountReceivablesByOrderIds", async () => ({}));
  try {
    const allowed = await request({ userId: 22 }, "/api/companies/20/orders");
    assert.equal(allowed.status, 200);
    assert.equal(getCompanyOrders.mock.calls.length, 1);

    const headerMismatch = await request({ userId: 22 }, "/api/companies/21/orders", { "X-Empresa-Id": "20" });
    assert.equal(headerMismatch.status, 403);
    assert.equal(getCompanyOrders.mock.calls.length, 1);

    companyExists = false;
    const inactiveOrMissing = await request({ userId: 22 }, "/api/companies/99/orders");
    assert.equal(inactiveOrMissing.status, 404);
    assert.equal(getCompanyOrders.mock.calls.length, 1);
  } finally {
    getReceivables.mock.restore();
    getCompanyOrders.mock.restore();
    getCompany.mock.restore();
    getUser.mock.restore();
  }
});

test("company orders route rejects anonymous callers and invalid company ids", async () => {
  const anonymous = await request(undefined, "/api/companies/20/orders");
  assert.equal(anonymous.status, 401);

  const getCompany = mock.method(storage, "getCompany", async (id: number) => ({ id, active: true } as any));
  try {
    const invalidId = await request({ companyId: 20 }, "/api/companies/0/orders");
    assert.equal(invalidId.status, 400);
  } finally {
    getCompany.mock.restore();
  }
});
