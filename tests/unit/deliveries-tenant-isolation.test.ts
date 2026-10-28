/**
 * Delivery tenant isolation tests.
 *
 * These tests use an in-memory fake and the same boundary policy used by the
 * logistics routes. They never connect to or mutate Supabase.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { mock } from "node:test";
import { requireAuth } from "../../server/core/http/requireAuth";
import { register as registerLegacyLogistics } from "../../server/routes/logistics.routes";
import { storage } from "../../server/services/storage";
import {
  isDeliveryInTenant,
  resolveDeliveryAccess,
  sanitizeDeliveryCreateBody,
  sanitizeDeliveryUpdateBody,
} from "../../server/modules/logistics/delivery.access";

type Delivery = {
  id: number;
  companyId: number | null;
  status: string;
};

function makeFakeRepository(initial: Delivery[]) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));

  return {
    get(id: number, tenantId: number | null) {
      const row = rows.get(id);
      return row && isDeliveryInTenant(row, tenantId) ? { ...row } : undefined;
    },
    create(body: Record<string, unknown>, tenantId: number | null) {
      const safe = sanitizeDeliveryCreateBody(body, tenantId);
      const row = {
        id: rows.size + 1,
        companyId: safe.companyId == null ? null : Number(safe.companyId),
        status: String(safe.status ?? "pendente"),
      };
      rows.set(row.id, row);
      return row;
    },
    update(id: number, tenantId: number | null, body: Record<string, unknown>) {
      const row = this.get(id, tenantId);
      if (!row) return undefined;
      const safe = sanitizeDeliveryUpdateBody(body);
      const updated = { ...row, ...safe, companyId: row.companyId };
      rows.set(id, updated as Delivery);
      return updated;
    },
    delete(id: number, tenantId: number | null) {
      if (!this.get(id, tenantId)) return false;
      rows.delete(id);
      return true;
    },
    snapshot() {
      return Array.from(rows.values()).map((row) => ({ ...row }));
    },
  };
}

const tenantA = { role: "ADMIN", empresaId: 10 };
const tenantB = { role: "ADMIN", empresaId: 20 };
const developerA = { role: "DEVELOPER", empresaId: 10 };
const globalMaster = { role: "MASTER", empresaId: null };
const globalDirector = { role: "DIRECTOR", empresaId: null };
const globalAdmin = { role: "ADMIN", empresaId: null };
const globalDeveloper = { role: "DEVELOPER", empresaId: null };
const internalCommercial = { role: "COMERCIAL", empresaId: null };
const internalLogistics = { role: "LOGISTICS", empresaId: null };

describe("deliveries — isolamento multi-tenant", () => {
  test("tenant A pode consultar delivery A", () => {
    const repo = makeFakeRepository([{ id: 1, companyId: 10, status: "pendente" }]);
    assert.ok(repo.get(1, resolveDeliveryAccess(tenantA).tenantId));
  });

  test("tenant A não consulta delivery B pelo ID", () => {
    const repo = makeFakeRepository([{ id: 2, companyId: 20, status: "pendente" }]);
    assert.equal(repo.get(2, resolveDeliveryAccess(tenantA).tenantId), undefined);
  });

  test("tenant A não atualiza delivery B", () => {
    const repo = makeFakeRepository([{ id: 2, companyId: 20, status: "pendente" }]);
    assert.equal(
      repo.update(2, resolveDeliveryAccess(tenantA).tenantId, { status: "entregue" }),
      undefined,
    );
    assert.equal(repo.get(2, 20)?.status, "pendente");
  });

  test("tenant A não altera status de delivery B", () => {
    const repo = makeFakeRepository([{ id: 2, companyId: 20, status: "pendente" }]);
    assert.equal(repo.update(2, 10, { status: "entregue" }), undefined);
    assert.equal(repo.get(2, 20)?.status, "pendente");
  });

  test("tenant A não exclui delivery B", () => {
    const repo = makeFakeRepository([{ id: 2, companyId: 20, status: "pendente" }]);
    assert.equal(repo.delete(2, 10), false);
    assert.equal(repo.snapshot().length, 1);
  });

  test("tenant A cria sempre no próprio tenant mesmo enviando companyId B", () => {
    const repo = makeFakeRepository([]);
    const created = repo.create({ companyId: 20, status: "pendente" }, 10);
    assert.equal(created.companyId, 10);
  });

  test("aliases company_id/empresa_id/tenant_id não fazem spoofing", () => {
    const safeCreate = sanitizeDeliveryCreateBody(
      { company_id: 20, empresaId: 20, empresa_id: 20, tenantId: 20, tenant_id: 20 },
      10,
    );
    assert.equal(safeCreate.companyId, 10);
    assert.equal("company_id" in safeCreate, false);
    assert.equal("empresaId" in safeCreate, false);
    assert.equal("empresa_id" in safeCreate, false);
    assert.equal("tenantId" in safeCreate, false);
    assert.equal("tenant_id" in safeCreate, false);

    const safeUpdate = sanitizeDeliveryUpdateBody({
      companyId: 20,
      company_id: 20,
      empresaId: 20,
      empresa_id: 20,
      tenantId: 20,
      tenant_id: 20,
      status: "entregue",
    });
    assert.deepEqual(safeUpdate, { status: "entregue" });
  });

  test("MASTER global preserva acesso global", () => {
    assert.deepEqual(resolveDeliveryAccess(globalMaster), { allowed: true, tenantId: null });
    assert.equal(
      makeFakeRepository([{ id: 1, companyId: 10, status: "pendente" }]).get(
        1,
        resolveDeliveryAccess(globalMaster).tenantId,
      )?.companyId,
      10,
    );
  });

  test("DIRECTOR global preserva acesso global", () => {
    assert.deepEqual(resolveDeliveryAccess(globalDirector), { allowed: true, tenantId: null });
  });

  test("ADMIN tenant-bound não acessa outro tenant", () => {
    assert.deepEqual(resolveDeliveryAccess(tenantA), { allowed: true, tenantId: 10 });
    assert.equal(
      makeFakeRepository([{ id: 2, companyId: 20, status: "pendente" }]).get(2, 10),
      undefined,
    );
  });

  test("DEVELOPER tenant-bound não acessa outro tenant", () => {
    assert.deepEqual(resolveDeliveryAccess(developerA), { allowed: true, tenantId: 10 });
    assert.equal(
      makeFakeRepository([{ id: 2, companyId: 20, status: "pendente" }]).get(2, 10),
      undefined,
    );
  });

  test("ADMIN e DEVELOPER unbound têm leitura global, mas gravações exigem tenant", () => {
    assert.deepEqual(resolveDeliveryAccess(globalAdmin), { allowed: true, tenantId: null });
    assert.deepEqual(resolveDeliveryAccess(globalDeveloper), { allowed: true, tenantId: null });
  });

  test("COMERCIAL e LOGISTICS leem entre empresas sem seleção, mas operações seguem exigindo tenant", () => {
    assert.deepEqual(resolveDeliveryAccess(internalCommercial, 10), { allowed: true, tenantId: 10 });
    assert.deepEqual(resolveDeliveryAccess(internalLogistics, 20), { allowed: true, tenantId: 20 });
    assert.equal(resolveDeliveryAccess(internalCommercial).allowed, false);
    assert.deepEqual(resolveDeliveryAccess(internalCommercial, null, true), { allowed: true, tenantId: null });
    assert.deepEqual(resolveDeliveryAccess(internalLogistics, null, true), { allowed: true, tenantId: null });
    assert.equal(resolveDeliveryAccess(internalLogistics, null).allowed, false);
    assert.equal(resolveDeliveryAccess({ role: "FINANCEIRO", empresaId: null }, 10).allowed, false);
  });

  test("papel global selecionado fica preso ao tenant escolhido para entregas", () => {
    assert.deepEqual(resolveDeliveryAccess(globalAdmin, 10), { allowed: true, tenantId: 10 });
    assert.equal(resolveDeliveryAccess({ role: "ADMIN", empresaId: 20 }, 10).allowed, false);
  });

  test("usuário sem autenticação recebe 401", () => {
    let received: any;
    requireAuth(
      { session: {} } as any,
      {} as any,
      (error?: unknown) => { received = error; },
    );
    assert.equal(received?.status, 401);
  });

  test("tentativa bloqueada não altera nenhum dado", () => {
    const repo = makeFakeRepository([
      { id: 1, companyId: 10, status: "pendente" },
      { id: 2, companyId: 20, status: "pendente" },
    ]);
    const before = repo.snapshot();
    assert.equal(repo.update(2, 10, { status: "entregue" }), undefined);
    assert.equal(repo.delete(2, 10), false);
    assert.deepEqual(repo.snapshot(), before);
  });

  test("rota HTTP força o tenant selecionado sobre companyId da query para COMERCIAL", async () => {
    const userLookup = mock.method(storage, "getUser", async () => ({
      id: 41, role: "COMERCIAL", empresaId: null, active: true, tabPermissions: null,
    } as any));
    const companyLookup = mock.method(storage, "getCompany", async (id: number) => ({
      id, active: true,
    } as any));
    const deliveriesLookup = mock.method(storage, "getDeliveries", async (filters: any) => {
      assert.equal(filters.companyId, 10);
      return [];
    });
    const app = express();
    app.use((req, _res, next) => { (req as any).session = { userId: 41 }; next(); });
    await registerLegacyLogistics(app as any);
    app.use((error: any, _req: any, res: any, _next: any) => {
      res.status(error?.status ?? 500).json({ message: error?.message });
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/deliveries?companyId=99`,
        { headers: { "X-Empresa-Id": "10" } },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), []);
      assert.ok(deliveriesLookup.mock.callCount() > 0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      deliveriesLookup.mock.restore();
      companyLookup.mock.restore();
      userLookup.mock.restore();
    }
  });

  test("rota HTTP bloqueia leitura de entregas quando a ação está negada", async () => {
    const userLookup = mock.method(storage, "getUser", async () => ({
      id: 42, role: "COMERCIAL", empresaId: null, active: true, tabPermissions: null,
      permissions: { actionOverridesV1: { logistics: { read: false } } },
    } as any));
    const companyLookup = mock.method(storage, "getCompany", async (id: number) => ({ id, active: true } as any));
    const deliveriesLookup = mock.method(storage, "getDeliveries", async () => []);
    const app = express();
    app.use((req, _res, next) => { (req as any).session = { userId: 42 }; next(); });
    await registerLegacyLogistics(app as any);
    app.use((error: any, _req: any, res: any, _next: any) => {
      res.status(error?.status ?? 500).json({ message: error?.message });
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/deliveries`, {
        headers: { "X-Empresa-Id": "10" },
      });
      assert.equal(response.status, 403);
      assert.equal(deliveriesLookup.mock.callCount(), 0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      deliveriesLookup.mock.restore();
      companyLookup.mock.restore();
      userLookup.mock.restore();
    }
  });
});
