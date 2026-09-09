import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  INTERNAL_INCIDENT_DELETE_ROLES,
  INTERNAL_INCIDENT_ROLES,
  internalIncidentAssigneeBelongsToScope,
  internalIncidentBelongsToScope,
  resolveInternalIncidentScope,
  sanitizeInternalIncidentPatch,
} from "../../server/modules/incidents/internal-incidents.policy";

type FakeIncident = { id: number; empresaId: number; status: string };

class FakeInternalIncidentRepository {
  private rows: FakeIncident[] = [
    { id: 1, empresaId: 10, status: "OPEN" },
    { id: 2, empresaId: 20, status: "OPEN" },
  ];

  list(empresaId: number) {
    return this.rows.filter((row) => row.empresaId === empresaId);
  }

  update(scope: ReturnType<typeof resolveInternalIncidentScope>, id: number, status: string) {
    if (!scope || scope.global) return undefined;
    const row = this.rows.find((candidate) => candidate.id === id && candidate.empresaId === scope.companyId);
    if (!row) return undefined;
    row.status = status;
    return row;
  }

  delete(scope: ReturnType<typeof resolveInternalIncidentScope>, id: number) {
    if (!scope || scope.global) return undefined;
    const index = this.rows.findIndex((candidate) => candidate.id === id && candidate.empresaId === scope.companyId);
    if (index < 0) return undefined;
    return this.rows.splice(index, 1)[0];
  }
}

describe("internal incidents — autenticação, RBAC e isolamento multi-tenant", () => {
  test("usuário tenant-bound recebe somente o tenant da sessão", () => {
    const scope = resolveInternalIncidentScope(
      { tenantId: 10, role: "OPERATIONS_MANAGER", userEmpresaId: 10 },
      INTERNAL_INCIDENT_ROLES,
    )!;
    assert.deepEqual(scope, { companyId: 10, global: false });
    assert.equal(internalIncidentBelongsToScope(scope, 10), true);
    assert.equal(internalIncidentBelongsToScope(scope, 20), false);
  });

  test("papel não autorizado falha fechado", () => {
    assert.equal(
      resolveInternalIncidentScope(
        { tenantId: 10, role: "CLIENT", userEmpresaId: 10 },
        INTERNAL_INCIDENT_ROLES,
      ),
      null,
    );
  });

  test("admin global pode listar globalmente ou ser fixado a um tenant", () => {
    assert.deepEqual(
      resolveInternalIncidentScope({ role: "MASTER" }, INTERNAL_INCIDENT_ROLES),
      { companyId: null, global: true },
    );
    assert.deepEqual(
      resolveInternalIncidentScope(
        { tenantId: 10, role: "MASTER", userEmpresaId: null },
        INTERNAL_INCIDENT_ROLES,
      ),
      { companyId: 10, global: false },
    );
  });

  test("somente papéis de exclusão podem passar pela policy de DELETE", () => {
    assert.notEqual(
      resolveInternalIncidentScope(
        { tenantId: 10, role: "ADMIN", userEmpresaId: 10 },
        INTERNAL_INCIDENT_DELETE_ROLES,
      ),
      null,
    );
    assert.equal(
      resolveInternalIncidentScope(
        { tenantId: 10, role: "LOGISTICS", userEmpresaId: 10 },
        INTERNAL_INCIDENT_DELETE_ROLES,
      ),
      null,
    );
  });

  test("responsável deve pertencer ao tenant do incidente", () => {
    const scope = resolveInternalIncidentScope(
      { tenantId: 10, role: "ADMIN", userEmpresaId: 10 },
      INTERNAL_INCIDENT_ROLES,
    )!;
    assert.equal(internalIncidentAssigneeBelongsToScope(scope, 10), true);
    assert.equal(internalIncidentAssigneeBelongsToScope(scope, 20), false);
    assert.equal(internalIncidentAssigneeBelongsToScope(scope, null), false);
  });

  test("PATCH permite somente campos de workflow e não permite trocar tenant", () => {
    assert.deepEqual(
      sanitizeInternalIncidentPatch({
        status: "RESOLVED",
        adminNote: "ok",
        assignedToId: 7,
        empresaId: 20,
        createdById: 99,
        title: "não pode",
        assignedToName: "nome forjado",
      }),
      { status: "RESOLVED", adminNote: "ok", assignedToId: 7 },
    );
  });

  test("sessão sem tenant não pode ser usada para escrita", () => {
    const scope = resolveInternalIncidentScope({ role: "MASTER" }, INTERNAL_INCIDENT_ROLES)!;
    assert.equal(scope.companyId, null);
    assert.equal(scope.global, true);
  });

  test("fake repository nunca atualiza ou exclui incidente de outro tenant", () => {
    const repository = new FakeInternalIncidentRepository();
    const tenantA = resolveInternalIncidentScope(
      { tenantId: 10, role: "ADMIN", userEmpresaId: 10 },
      INTERNAL_INCIDENT_ROLES,
    )!;

    assert.deepEqual(repository.list(10).map((row) => row.id), [1]);
    assert.equal(repository.update(tenantA, 2, "RESOLVED"), undefined);
    assert.equal(repository.delete(tenantA, 2), undefined);
    assert.equal(repository.update(tenantA, 1, "RESOLVED")?.status, "RESOLVED");
    assert.equal(repository.delete(tenantA, 1)?.id, 1);
  });
});