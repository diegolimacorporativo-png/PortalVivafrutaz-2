import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "../../server/core/http/requireAuth";
import {
  canDeleteQuotations,
  hasQuotationTenantOverride,
  resolveQuotationScope,
  sanitizeQuotationCreateBody,
  sanitizeQuotationUpdateBody,
} from "../../server/modules/quotations/quotations.policy";

type Quotation = {
  id: number;
  empresaId: number | null;
  status: string;
};

function makeFakeRepository(initial: Quotation[]) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  let nextId = Math.max(0, ...initial.map((row) => row.id)) + 1;

  return {
    create(body: Record<string, unknown>, scope: ReturnType<typeof resolveQuotationScope>) {
      if (!scope) return undefined;
      const safe = sanitizeQuotationCreateBody(body);
      const row = {
        id: nextId++,
        empresaId: scope.global ? null : scope.empresaId,
        status: String(safe.status ?? "PENDING"),
      };
      rows.set(row.id, row);
      return row;
    },
    list(scope: ReturnType<typeof resolveQuotationScope>) {
      if (!scope) return [];
      return Array.from(rows.values()).filter(
        (row) => scope.global || row.empresaId === scope.empresaId,
      );
    },
    get(id: number, scope: ReturnType<typeof resolveQuotationScope>) {
      const row = rows.get(id);
      if (!row || !scope || (!scope.global && row.empresaId !== scope.empresaId)) {
        return undefined;
      }
      return { ...row };
    },
    update(id: number, scope: ReturnType<typeof resolveQuotationScope>, body: Record<string, unknown>) {
      const row = this.get(id, scope);
      if (!row) return undefined;
      const safe = sanitizeQuotationUpdateBody(body);
      const updated = { ...row, status: String(safe.status ?? row.status), empresaId: row.empresaId };
      rows.set(id, updated);
      return updated;
    },
    delete(id: number, scope: ReturnType<typeof resolveQuotationScope>) {
      if (!this.get(id, scope)) return false;
      rows.delete(id);
      return true;
    },
    snapshot() {
      return Array.from(rows.values()).map((row) => ({ ...row }));
    },
  };
}

const tenantA = { role: "ADMIN", empresaId: 10 };
const tenantB = { role: "DEVELOPER", empresaId: 20 };
const globalMaster = { role: "MASTER", empresaId: null };
const globalDirector = { role: "DIRECTOR", empresaId: null };

describe("quotations — isolamento multi-tenant", () => {
  test("tenant A acessa somente sua própria quotation", () => {
    const repo = makeFakeRepository([
      { id: 1, empresaId: 10, status: "PENDING" },
      { id: 2, empresaId: 20, status: "PENDING" },
    ]);
    const scopeA = resolveQuotationScope(tenantA);
    assert.equal(repo.get(1, scopeA)?.empresaId, 10);
    assert.equal(repo.get(2, scopeA), undefined);
    assert.deepEqual(repo.list(scopeA).map((row) => row.id), [1]);
  });

  test("tenant A não altera nem exclui quotation B por ID", () => {
    const repo = makeFakeRepository([{ id: 2, empresaId: 20, status: "PENDING" }]);
    const scopeA = resolveQuotationScope(tenantA);
    assert.equal(repo.update(2, scopeA, { status: "APPROVED" }), undefined);
    assert.equal(repo.delete(2, scopeA), false);
    assert.equal(repo.get(2, resolveQuotationScope(tenantB))?.status, "PENDING");
  });

  test("criação de tenant A permanece em A mesmo com spoofing", () => {
    const repo = makeFakeRepository([]);
    const created = repo.create({ empresaId: 20, companyId: 20, status: "PENDING" }, resolveQuotationScope(tenantA));
    assert.equal(created?.empresaId, 10);
  });

  test("aliases de tenant são detectados e nunca entram no update seguro", () => {
    const body = {
      companyId: 20,
      company_id: 20,
      empresaId: 20,
      empresa_id: 20,
      tenantId: 20,
      tenant_id: 20,
      status: "APPROVED",
      createdAt: "spoof",
    };
    assert.equal(hasQuotationTenantOverride(body), true);
    assert.deepEqual(sanitizeQuotationUpdateBody(body), { status: "APPROVED" });
  });

  test("MASTER e DIRECTOR sem empresa preservam acesso global", () => {
    const repo = makeFakeRepository([
      { id: 1, empresaId: 10, status: "PENDING" },
      { id: 2, empresaId: 20, status: "PENDING" },
      { id: 3, empresaId: null, status: "PENDING" },
    ]);
    assert.equal(repo.list(resolveQuotationScope(globalMaster)).length, 3);
    assert.equal(repo.list(resolveQuotationScope(globalDirector)).length, 3);
  });

  test("ADMIN/DEVELOPER vinculados permanecem tenant-bound", () => {
    assert.deepEqual(resolveQuotationScope(tenantA), { global: false, empresaId: 10 });
    assert.deepEqual(resolveQuotationScope(tenantB), { global: false, empresaId: 20 });
  });

  test("usuário administrativo sem tenant não recebe acesso global automático", () => {
    assert.equal(resolveQuotationScope({ role: "ADMIN", empresaId: null }), null);
  });

  test("sem sessão ou role não autorizado não resolve escopo", () => {
    assert.equal(resolveQuotationScope(null), null);
    assert.equal(resolveQuotationScope({ role: "CLIENT", empresaId: 10 }), null);
  });

  test("sem sessão a rota protegida recebe 401", () => {
    let received: any;
    requireAuth(
      { session: {} } as any,
      {} as any,
      (error?: unknown) => { received = error; },
    );
    assert.equal(received?.status, 401);
  });

  test("papéis de exclusão permanecem restritos à política existente", () => {
    assert.equal(canDeleteQuotations("ADMIN"), true);
    assert.equal(canDeleteQuotations("DEVELOPER"), true);
    assert.equal(canDeleteQuotations("OPERATIONS_MANAGER"), false);
    assert.equal(canDeleteQuotations("LOGISTICS"), false);
  });
});