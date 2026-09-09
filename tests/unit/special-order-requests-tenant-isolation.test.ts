import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SPECIAL_ORDER_MANAGE_ROLES,
  SPECIAL_ORDER_VIEW_ROLES,
  type SpecialOrderScope,
  resolveSpecialOrderCreationCompanyId,
  resolveSpecialOrderScope,
  specialOrderBelongsToScope,
} from "../../server/modules/special-orders/special-order-requests.policy";

type FakeRequest = { id: number; companyId: number; status: string };

class FakeSpecialOrderRepository {
  private rows: FakeRequest[] = [];
  private nextId = 1;

  createFromCompanySession(sessionCompanyId: unknown, requestedCompanyId: unknown): FakeRequest | undefined {
    const companyId = resolveSpecialOrderCreationCompanyId(sessionCompanyId, requestedCompanyId);
    if (companyId == null) return undefined;
    const row = { id: this.nextId++, companyId, status: "PENDING" };
    this.rows.push(row);
    return row;
  }

  list(scope: SpecialOrderScope): FakeRequest[] {
    return this.rows.filter((row) => specialOrderBelongsToScope(scope, row.companyId));
  }

  update(scope: SpecialOrderScope, id: number, status: string): FakeRequest | undefined {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || !specialOrderBelongsToScope(scope, row.companyId)) return undefined;
    row.status = status;
    return row;
  }
}

describe("special order requests — isolamento e autorização", () => {
  test("tenant A cria uma solicitação para A", () => {
    const repo = new FakeSpecialOrderRepository();
    const created = repo.createFromCompanySession(10, undefined);
    assert.equal(created?.companyId, 10);
  });

  test("tenant A envia companyId B, mas o tenant da sessão prevalece", () => {
    const repo = new FakeSpecialOrderRepository();
    const created = repo.createFromCompanySession(10, 20);
    assert.equal(created?.companyId, 10);
  });

  test("tenant A não consegue listar solicitações de B", () => {
    const repo = new FakeSpecialOrderRepository();
    repo.createFromCompanySession(10, 20);
    repo.createFromCompanySession(20, 10);
    const scopeA = resolveSpecialOrderScope({ sessionCompanyId: 10 }, SPECIAL_ORDER_VIEW_ROLES)!;
    assert.deepEqual(repo.list(scopeA).map((row) => row.companyId), [10]);
  });

  test("tenant B não consegue acessar nem alterar solicitação de A por ID", () => {
    const repo = new FakeSpecialOrderRepository();
    const requestA = repo.createFromCompanySession(10, 10)!;
    const scopeB = resolveSpecialOrderScope({
      tenantId: 20,
      userEmpresaId: 20,
      role: "ADMIN",
    }, SPECIAL_ORDER_MANAGE_ROLES)!;
    assert.equal(specialOrderBelongsToScope(scopeB, requestA.companyId), false);
    assert.equal(repo.update(scopeB, requestA.id, "APPROVED"), undefined);
  });

  test("usuário sem autenticação não resolve escopo administrativo", () => {
    assert.equal(resolveSpecialOrderScope({}, SPECIAL_ORDER_VIEW_ROLES), null);
  });

  test("usuário autenticado sem role necessária não resolve escopo", () => {
    assert.equal(resolveSpecialOrderScope({
      tenantId: 10,
      userEmpresaId: 10,
      role: "CLIENT",
    }, SPECIAL_ORDER_VIEW_ROLES), null);
  });

  test("admin tenant-bound vê somente seu tenant", () => {
    const scope = resolveSpecialOrderScope({
      tenantId: 10,
      userEmpresaId: 10,
      role: "ADMIN",
    }, SPECIAL_ORDER_VIEW_ROLES);
    assert.deepEqual(scope, { companyId: 10, global: false });
  });

  test("papel global autorizado mantém a listagem global", () => {
    const scope = resolveSpecialOrderScope({ role: "MASTER" }, SPECIAL_ORDER_VIEW_ROLES);
    assert.deepEqual(scope, { companyId: null, global: true });
  });

  test("papel não global sem empresa não pode escolher tenant por query", () => {
    assert.equal(resolveSpecialOrderScope({
      tenantId: 20,
      userEmpresaId: null,
      role: "OPERATIONS_MANAGER",
    }, SPECIAL_ORDER_VIEW_ROLES), null);
  });

  test("admin global pode limitar a consulta a um tenant explicitamente selecionado", () => {
    const scope = resolveSpecialOrderScope({
      tenantId: 20,
      userEmpresaId: null,
      role: "DIRECTOR",
    }, SPECIAL_ORDER_VIEW_ROLES);
    assert.deepEqual(scope, { companyId: 20, global: false });
  });

  test("aprovação permanece restrita aos papéis administrativos de gerenciamento", () => {
    assert.equal(SPECIAL_ORDER_MANAGE_ROLES.includes("ADMIN"), true);
    assert.equal(SPECIAL_ORDER_MANAGE_ROLES.includes("OPERATIONS_MANAGER"), false);
    assert.equal(SPECIAL_ORDER_MANAGE_ROLES.includes("LOGISTICS"), false);
  });
});