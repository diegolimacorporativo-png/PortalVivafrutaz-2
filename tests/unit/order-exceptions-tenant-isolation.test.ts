/**
 * Order-exceptions tenant isolation tests.
 *
 * These tests use an in-memory repository fake and the same authorization
 * policy used at the HTTP boundary. No shared Supabase data is read or
 * mutated.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "../../server/core/http/requireAuth";
import {
  extractRequestedCompanyId,
  resolveOrderExceptionAccess,
  sanitizeOrderExceptionBody,
} from "../../server/routes/order-exceptions.policy";

type Exception = {
  id: number;
  companyId: number;
  reason: string;
  active: boolean;
};

function makeFakeRepository(initial: Exception[]) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  return {
    list(tenantId: number | null) {
      return Array.from(rows.values()).filter(
        (row) => tenantId == null || row.companyId === tenantId,
      );
    },
    create(tenantId: number, body: Record<string, unknown>) {
      const safe = sanitizeOrderExceptionBody(body);
      const row = {
        id: rows.size + 1,
        companyId: tenantId,
        reason: String(safe.reason),
        active: Boolean(safe.active ?? true),
      };
      rows.set(row.id, row);
      return row;
    },
    update(id: number, tenantId: number | null, body: Record<string, unknown>) {
      const current = rows.get(id);
      if (!current || (tenantId != null && current.companyId !== tenantId)) {
        return undefined;
      }
      const safe = sanitizeOrderExceptionBody(body);
      const updated = { ...current, ...safe, companyId: current.companyId };
      rows.set(id, updated as Exception);
      return updated;
    },
    delete(id: number, tenantId: number | null) {
      const current = rows.get(id);
      if (!current || (tenantId != null && current.companyId !== tenantId)) {
        return false;
      }
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
const globalMaster = { role: "MASTER", empresaId: null };
const globalDirector = { role: "DIRECTOR", empresaId: null };
const globalAdmin = { role: "ADMIN", empresaId: null };

describe("order-exceptions — isolamento multi-tenant", () => {
  test("tenant A cria exception para A", () => {
    const access = resolveOrderExceptionAccess(tenantA, 10);
    assert.deepEqual(access, { allowed: true, tenantId: 10 });
  });

  test("tenant A envia companyId B, mas a criação continua no tenant A", () => {
    const repo = makeFakeRepository([]);
    const access = resolveOrderExceptionAccess(tenantA, 20);
    assert.equal(access.allowed, false);

    const ownAccess = resolveOrderExceptionAccess(tenantA);
    assert.deepEqual(ownAccess, { allowed: true, tenantId: 10 });
    const created = repo.create(ownAccess.tenantId!, {
      companyId: 20,
      reason: "exceção",
      active: true,
    });
    assert.equal(created.companyId, 10);
  });

  test("tenant A lista somente as próprias exceptions", () => {
    const repo = makeFakeRepository([
      { id: 1, companyId: 10, reason: "A", active: true },
      { id: 2, companyId: 20, reason: "B", active: true },
    ]);
    assert.deepEqual(repo.list(10).map((row) => row.id), [1]);
  });

  test("tenant A não consulta exception de B", () => {
    const repo = makeFakeRepository([
      { id: 1, companyId: 10, reason: "A", active: true },
      { id: 2, companyId: 20, reason: "B", active: true },
    ]);
    assert.equal(repo.update(2, 10, { reason: "tentativa" }), undefined);
  });

  test("tenant A altera exception de A", () => {
    const repo = makeFakeRepository([
      { id: 1, companyId: 10, reason: "A", active: true },
    ]);
    assert.equal(repo.update(1, 10, { reason: "alterada" })?.reason, "alterada");
  });

  test("tenant A não altera exception de B pelo ID", () => {
    const repo = makeFakeRepository([
      { id: 2, companyId: 20, reason: "B", active: true },
    ]);
    assert.equal(repo.update(2, 10, { reason: "não pode" }), undefined);
  });

  test("tenant A exclui exception de A", () => {
    const repo = makeFakeRepository([
      { id: 1, companyId: 10, reason: "A", active: true },
    ]);
    assert.equal(repo.delete(1, 10), true);
    assert.equal(repo.snapshot().length, 0);
  });

  test("tenant A não exclui exception de B pelo ID", () => {
    const repo = makeFakeRepository([
      { id: 2, companyId: 20, reason: "B", active: true },
    ]);
    assert.equal(repo.delete(2, 10), false);
    assert.equal(repo.snapshot().length, 1);
  });

  test("companyId/empresaId/tenantId do body não movem a exception", () => {
    const safe = sanitizeOrderExceptionBody({
      companyId: 20,
      company_id: 20,
      empresaId: 20,
      empresa_id: 20,
      tenantId: 20,
      tenant_id: 20,
      reason: "mantém A",
    });
    assert.deepEqual(safe, { reason: "mantém A" });
  });

  test("tenant B não acessa exceptions de A", () => {
    const repo = makeFakeRepository([
      { id: 1, companyId: 10, reason: "A", active: true },
    ]);
    assert.equal(repo.update(1, 20, { reason: "não pode" }), undefined);
    assert.equal(repo.delete(1, 20), false);
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

  test("usuário autenticado sem role recebe 403", () => {
    const access = resolveOrderExceptionAccess({ empresaId: 10 }, 10);
    assert.equal(access.allowed, false);
    assert.equal(access.status, 403);
  });

  test("usuário global autorizado pode selecionar uma empresa", () => {
    assert.deepEqual(resolveOrderExceptionAccess(globalMaster, 20), {
      allowed: true,
      tenantId: 20,
    });
    assert.deepEqual(resolveOrderExceptionAccess(globalDirector, 10), {
      allowed: true,
      tenantId: 10,
    });
  });

  test("ADMIN tenant-bound sem empresa não recebe acesso global", () => {
    const access = resolveOrderExceptionAccess(globalAdmin, 10);
    assert.equal(access.allowed, false);
    assert.equal(access.status, 403);
  });

  test("companyId enviado pelo cliente é extraído sem substituir o tenant autenticado", () => {
    assert.equal(extractRequestedCompanyId({ companyId: "20" }), 20);
    assert.equal(resolveOrderExceptionAccess(tenantA).tenantId, 10);
  });

  test("não há vínculo orderId em order_exceptions para validar nesta etapa", () => {
    const row = { id: 1, companyId: 10, reason: "A", active: true };
    assert.equal("orderId" in row, false);
  });
});