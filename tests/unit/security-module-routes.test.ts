import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { test } from "node:test";
import { definition, securityRouter } from "../../server/modules/security";
import { securityController } from "../../server/modules/security/security.controller";
import { securityService } from "../../server/modules/security/security.service";
import { storage } from "../../server/services/storage";

async function request(app: express.Express, path: string) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function makeApp(actor: { userId?: number; userRole?: string } = {}) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = actor;
    next();
  });
  app.use(definition.basePath, securityRouter);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error?.status ?? 500).json({ message: error?.message ?? "error" });
  });
  return app;
}

test("security summary module keeps its API mount and rejects anonymous or non-admin callers", async () => {
  assert.equal(definition.basePath, "/api/admin/security");
  assert.equal(definition.router, securityRouter);

  const anonymous = await request(makeApp(), "/api/admin/security/resumo");
  assert.equal(anonymous.status, 401);

  const client = await request(makeApp({ userId: 8, userRole: "CLIENT" }), "/api/admin/security/resumo");
  assert.equal(client.status, 403);
});

test("security summary module preserves the JSON response contract for an admin", async (t) => {
  t.mock.method(securityController, "resumo", async (_req, res) => {
    return res.json({ success: true, data: [{ type: "synthetic", total: 2 }] });
  });

  const response = await request(
    makeApp({ userId: 1, userRole: "MASTER" }),
    "/api/admin/security/resumo",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true, data: [{ type: "synthetic", total: 2 }] });
});

test("tenant mismatch audit keeps the strict global-role guard and response contract", async (t) => {
  const queryCalls: number[] = [];
  t.mock.method(storage, "getUser", async (id: number) => ({
    id,
    role: "MASTER",
    empresaId: null,
  }) as any);
  t.mock.method(securityService, "getTenantMismatchEvents", async (days: number) => {
    queryCalls.push(days);
    return { total: 3, windowDays: days } as any;
  });

  const response = await request(
    makeApp({ userId: 1, userRole: "MASTER" }),
    "/api/admin/security/tenant-mismatch-events?days=30",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true, data: { total: 3, windowDays: 30 } });
  assert.deepEqual(queryCalls, [30]);
});

test("legacy company association does not revoke MASTER access to cross-tenant audit", async (t) => {
  t.mock.method(storage, "getUser", async (id: number) => ({
    id,
    role: "MASTER",
    empresaId: 12,
  }) as any);

  const response = await request(
    makeApp({ userId: 1, userRole: "MASTER" }),
    "/api/admin/security/tenant-mismatch-events",
  );
  assert.equal(response.status, 200);
});

test("tenant mismatch audit preserves its error envelope", async (t) => {
  t.mock.method(storage, "getUser", async (id: number) => ({
    id,
    role: "DIRECTOR",
    empresaId: null,
  }) as any);
  t.mock.method(securityService, "getTenantMismatchEvents", async () => {
    throw new Error("synthetic audit failure");
  });

  const response = await request(
    makeApp({ userId: 2, userRole: "DIRECTOR" }),
    "/api/admin/security/tenant-mismatch-events",
  );
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    success: false,
    error: { code: "TENANT_MISMATCH_AUDIT_FAILED", message: "synthetic audit failure" },
  });
});
