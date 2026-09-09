/**
 * Delivery tenant isolation tests.
 *
 * These tests use an in-memory fake and the same boundary policy used by the
 * logistics routes. They never connect to or mutate Supabase.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "../../server/core/http/requireAuth";
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

  test("ADMIN sem tenant não recebe acesso global automaticamente", () => {
    assert.equal(resolveDeliveryAccess(globalAdmin).allowed, false);
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
});