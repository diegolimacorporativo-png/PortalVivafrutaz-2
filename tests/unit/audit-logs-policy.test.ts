import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { storage } from "../../server/services/storage";
import { register } from "../../server/routes/logs.routes";
import {
  canAccessAuditLogs,
  parseRequestedCompanyId,
  resolveAuditScope,
  sanitizeManualClientLog,
} from "../../server/modules/audit/audit-log.policy";

type FakeActor = {
  id: number;
  role: string;
  empresaId: number | null;
  email: string;
};

const tenantA: FakeActor = { id: 1, role: "ADMIN", empresaId: 10, email: "a@example.test" };
const tenantB: FakeActor = { id: 2, role: "DEVELOPER", empresaId: 20, email: "b@example.test" };
const masterGlobal: FakeActor = { id: 3, role: "MASTER", empresaId: null, email: "master@example.test" };
const directorGlobal: FakeActor = { id: 4, role: "DIRECTOR", empresaId: null, email: "director@example.test" };

function withSession(session: Record<string, unknown> = {}) {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as any).session = session;
    next();
  };
}

async function request(app: express.Express, method: string, path: string, body?: unknown) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function makeLogsApp(actor: FakeActor | null, capture: Record<string, any>) {
  const app = express();
  app.use(express.json());
  app.use(withSession(actor ? { userId: actor.id } : {}));
  void register(app);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error?.status ?? 500).json({ message: error?.message ?? "error" });
  });

  const originalGetUser = storage.getUser;
  const originalGetLogsScoped = storage.getLogsScoped;
  const originalCreateLog = storage.createLog;
  const originalDeleteLogsByIdsScoped = storage.deleteLogsByIdsScoped;
  const originalClearLogsScoped = storage.clearLogsScoped;
  const originalDeleteLogsByDateRangeScoped = storage.deleteLogsByDateRangeScoped;

  storage.getUser = (async () => actor) as typeof storage.getUser;
  storage.getLogsScoped = (async (limit: number, companyId?: number) => {
    capture.get = { limit, companyId };
    return [];
  }) as typeof storage.getLogsScoped;
  storage.createLog = (async (entry: any) => {
    capture.created = entry;
  }) as typeof storage.createLog;
  storage.deleteLogsByIdsScoped = (async (ids: number[], companyId?: number) => {
    capture.deletedIds = { ids, companyId };
    return ids.length;
  }) as typeof storage.deleteLogsByIdsScoped;
  storage.clearLogsScoped = (async (companyId?: number) => {
    capture.clearedCompanyId = companyId;
  }) as typeof storage.clearLogsScoped;
  storage.deleteLogsByDateRangeScoped = (async (_start: Date, _end: Date, companyId?: number) => {
    capture.deletedDateCompanyId = companyId;
    return 0;
  }) as typeof storage.deleteLogsByDateRangeScoped;

  const restore = () => {
    storage.getUser = originalGetUser;
    storage.getLogsScoped = originalGetLogsScoped;
    storage.createLog = originalCreateLog;
    storage.deleteLogsByIdsScoped = originalDeleteLogsByIdsScoped;
    storage.clearLogsScoped = originalClearLogsScoped;
    storage.deleteLogsByDateRangeScoped = originalDeleteLogsByDateRangeScoped;
  };
  return { app, restore };
}

describe("política de audit logs", () => {
  test("usuário tenant A consulta somente os próprios logs", () => {
    assert.deepEqual(resolveAuditScope(tenantA), { kind: "tenant", companyId: 10 });
  });

  test("tenant A não escapa com companyId, empresaId ou tenantId", () => {
    assert.deepEqual(resolveAuditScope(tenantA, 20), { kind: "tenant", companyId: 10 });
    assert.equal(parseRequestedCompanyId({ companyId: "20" }), 20);
    assert.equal(parseRequestedCompanyId({ empresaId: "20" }), 20);
    assert.equal(parseRequestedCompanyId({ tenantId: "20" }), 20);
  });

  test("ADMIN/DEVELOPER sem tenant falham fechado", () => {
    assert.equal(resolveAuditScope({ role: "ADMIN", empresaId: null }), null);
    assert.equal(resolveAuditScope({ role: "DEVELOPER", empresaId: null }), null);
  });

  test("MASTER e DIRECTOR globais preservam leitura global e filtro explícito", () => {
    assert.deepEqual(resolveAuditScope(masterGlobal), { kind: "global" });
    assert.deepEqual(resolveAuditScope(masterGlobal, 20), { kind: "global", companyId: 20 });
    assert.deepEqual(resolveAuditScope(directorGlobal), { kind: "global" });
  });

  test("role inadequada não acessa logs", () => {
    assert.equal(canAccessAuditLogs({ role: "LOGISTICS", empresaId: 10 }), false);
    assert.equal(resolveAuditScope({ role: "LOGISTICS", empresaId: 10 }), null);
  });

  test("POST manual aceita somente eventos de erro do frontend", () => {
    assert.deepEqual(
      sanitizeManualClientLog({ action: "FRONTEND_ERROR", description: "falha", level: "ERROR" }),
      { action: "FRONTEND_ERROR", description: "falha", level: "ERROR" },
    );
    assert.equal(sanitizeManualClientLog({ action: "IMPERSONATE_ADMIN", description: "fake" }), null);
  });

  test("POST manual não aceita actor, tenant ou timestamp enviados pelo cliente", () => {
    const safe = sanitizeManualClientLog({
      action: "FRONTEND_ERROR",
      description: "falha",
      userId: 999,
      companyId: 999,
      userRole: "MASTER",
      createdAt: "2099-01-01",
    });
    assert.deepEqual(safe, { action: "FRONTEND_ERROR", description: "falha", level: "INFO" });
    assert.equal((safe as any)?.userId, undefined);
    assert.equal((safe as any)?.companyId, undefined);
  });

  test("GET sem sessão retorna 401", async () => {
    const capture: Record<string, any> = {};
    const fixture = makeLogsApp(null, capture);
    try {
      assert.equal((await request(fixture.app, "GET", "/api/admin/logs")).status, 401);
    } finally {
      fixture.restore();
    }
  });

  test("GET tenant A ignora filtro apontando para B", async () => {
    const capture: Record<string, any> = {};
    const fixture = makeLogsApp(tenantA, capture);
    try {
      const response = await request(fixture.app, "GET", "/api/admin/logs?companyId=20&empresaId=20&tenantId=20");
      assert.equal(response.status, 200);
      assert.equal(capture.get.companyId, 10);
    } finally {
      fixture.restore();
    }
  });

  test("GET tenant B permanece limitado a B", async () => {
    const capture: Record<string, any> = {};
    const fixture = makeLogsApp(tenantB, capture);
    try {
      assert.equal((await request(fixture.app, "GET", "/api/admin/logs")).status, 200);
      assert.equal(capture.get.companyId, 20);
    } finally {
      fixture.restore();
    }
  });

  test("GET sem role adequada retorna 403", async () => {
    const capture: Record<string, any> = {};
    const fixture = makeLogsApp({ ...tenantA, role: "LOGISTICS" }, capture);
    try {
      assert.equal((await request(fixture.app, "GET", "/api/admin/logs")).status, 403);
    } finally {
      fixture.restore();
    }
  });

  test("GET global MASTER mantém comportamento global", async () => {
    const capture: Record<string, any> = {};
    const fixture = makeLogsApp(masterGlobal, capture);
    try {
      assert.equal((await request(fixture.app, "GET", "/api/admin/logs")).status, 200);
      assert.equal(capture.get.companyId, undefined);
    } finally {
      fixture.restore();
    }
  });

  test("DELETE selected tenant A não exclui IDs de B", async () => {
    const capture: Record<string, any> = {};
    const fixture = makeLogsApp(tenantA, capture);
    try {
      const response = await request(fixture.app, "DELETE", "/api/logs/selected", { ids: [1, 2] });
      assert.equal(response.status, 200);
      assert.deepEqual(capture.deletedIds, { ids: [1, 2], companyId: 10 });
    } finally {
      fixture.restore();
    }
  });

  test("DELETE por data tenant A leva o tenant ao storage", async () => {
    const capture: Record<string, any> = {};
    const fixture = makeLogsApp(tenantA, capture);
    try {
      assert.equal(
        (await request(fixture.app, "DELETE", "/api/logs/by-date", { startDate: "2026-01-01", endDate: "2026-01-31" })).status,
        200,
      );
      assert.equal(capture.deletedDateCompanyId, 10);
    } finally {
      fixture.restore();
    }
  });

  test("DELETE exige autorização apropriada", async () => {
    const capture: Record<string, any> = {};
    const fixture = makeLogsApp({ ...tenantA, role: "LOGISTICS" }, capture);
    try {
      assert.equal((await request(fixture.app, "DELETE", "/api/logs")).status, 403);
    } finally {
      fixture.restore();
    }
  });
});