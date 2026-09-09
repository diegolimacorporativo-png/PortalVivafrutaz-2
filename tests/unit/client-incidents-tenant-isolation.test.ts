import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_INCIDENT_DELETE_ROLES,
  CLIENT_INCIDENT_ROLES,
  type ClientIncidentScope,
  incidentBelongsToScope,
  resolveClientIncidentScope,
  resolveIncidentCreationCompanyId,
  sanitizeIncidentPatch,
} from "../../server/modules/incidents/client-incidents.policy";

type FakeIncident = { id: number; companyId: number; status: string };

class FakeIncidentRepository {
  private rows: FakeIncident[] = [];
  private nextId = 1;

  create(scope: ClientIncidentScope, requestedCompanyId: unknown): FakeIncident | undefined {
    const companyId = resolveIncidentCreationCompanyId(scope, requestedCompanyId);
    if (companyId == null) return undefined;
    const row = { id: this.nextId++, companyId, status: "OPEN" };
    this.rows.push(row);
    return row;
  }

  list(scope: ClientIncidentScope): FakeIncident[] {
    return this.rows.filter((row) => incidentBelongsToScope(scope, row.companyId));
  }

  update(scope: ClientIncidentScope, id: number, status: string): FakeIncident | undefined {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || !incidentBelongsToScope(scope, row.companyId)) return undefined;
    row.status = status;
    return row;
  }

  delete(scope: ClientIncidentScope, id: number): FakeIncident | undefined {
    const index = this.rows.findIndex((candidate) => candidate.id === id);
    if (index < 0 || !incidentBelongsToScope(scope, this.rows[index].companyId)) return undefined;
    return this.rows.splice(index, 1)[0];
  }
}

describe("client incidents — isolamento multi-tenant", () => {
  test("tenant A cria sem companyId e recebe o tenant da sessão", () => {
    const scope = resolveClientIncidentScope({ sessionCompanyId: 10 }, CLIENT_INCIDENT_ROLES);
    assert.deepEqual(scope, { companyId: 10, global: false });
    assert.equal(resolveIncidentCreationCompanyId(scope!, undefined), 10);
  });

  test("tenant A ignora companyId da empresa B na criação", () => {
    const scope = resolveClientIncidentScope({ sessionCompanyId: 10 }, CLIENT_INCIDENT_ROLES);
    assert.equal(resolveIncidentCreationCompanyId(scope!, 20), 10);
  });

  test("tenant A consulta somente os próprios incidentes", () => {
    const scope = resolveClientIncidentScope({ sessionCompanyId: 10 }, CLIENT_INCIDENT_ROLES)!;
    assert.equal(incidentBelongsToScope(scope, 10), true);
    assert.equal(incidentBelongsToScope(scope, 20), false);
  });

  test("tenant-bound admin permanece preso ao tenant da sessão", () => {
    const scope = resolveClientIncidentScope({ tenantId: 10, role: "ADMIN", userEmpresaId: 10 }, CLIENT_INCIDENT_ROLES);
    assert.deepEqual(scope, { companyId: 10, global: false });
    assert.equal(incidentBelongsToScope(scope!, 20), false);
  });

  test("admin global pode usar o fluxo global existente", () => {
    const scope = resolveClientIncidentScope({ role: "MASTER" }, CLIENT_INCIDENT_ROLES);
    assert.deepEqual(scope, { companyId: null, global: true });
    assert.equal(incidentBelongsToScope(scope!, 20), true);
    assert.equal(resolveIncidentCreationCompanyId(scope!, 20), 20);
  });

  test("admin global pode ser limitado a um tenant explicitamente selecionado", () => {
    const scope = resolveClientIncidentScope({ tenantId: 10, role: "MASTER", userEmpresaId: null }, CLIENT_INCIDENT_ROLES);
    assert.deepEqual(scope, { companyId: 10, global: false });
    assert.equal(resolveIncidentCreationCompanyId(scope!, 20), 10);
  });

  test("admin sem tenant e sem papel global falha fechado", () => {
    assert.equal(resolveClientIncidentScope({ tenantId: 20, role: "LOGISTICS", userEmpresaId: null }, CLIENT_INCIDENT_ROLES), null);
  });

  test("usuário autenticado sem papel permitido não acessa incidentes", () => {
    assert.equal(resolveClientIncidentScope({ tenantId: 10, role: "CLIENT" }, CLIENT_INCIDENT_ROLES), null);
  });

  test("PATCH do próprio tenant é permitido", () => {
    const scope = resolveClientIncidentScope({ tenantId: 10, role: "OPERATIONS_MANAGER", userEmpresaId: 10 }, CLIENT_INCIDENT_ROLES)!;
    assert.equal(incidentBelongsToScope(scope, 10), true);
  });

  test("PATCH/DELETE de outro tenant são bloqueados pela ownership check", () => {
    const scope = resolveClientIncidentScope({ tenantId: 10, role: "ADMIN", userEmpresaId: 10 }, CLIENT_INCIDENT_DELETE_ROLES)!;
    assert.equal(incidentBelongsToScope(scope, 20), false);
  });

  test("PATCH descarta companyId, empresaId e campos arbitrários", () => {
    assert.deepEqual(
      sanitizeIncidentPatch({
        status: "RESOLVED",
        adminNote: "ok",
        companyId: 20,
        empresaId: 20,
        empresa_id: 20,
        description: "não pode ser alterada",
      }),
      { status: "RESOLVED", adminNote: "ok" },
    );
  });

  test("sessão sem autenticação não resolve escopo", () => {
    assert.equal(resolveClientIncidentScope({}, CLIENT_INCIDENT_ROLES), null);
  });

  test("fake repository cobre create/list/update/delete sem tocar no Supabase", () => {
    const repo = new FakeIncidentRepository();
    const tenantA = resolveClientIncidentScope({ sessionCompanyId: 10 }, CLIENT_INCIDENT_ROLES)!;
    const global = resolveClientIncidentScope({ role: "MASTER" }, CLIENT_INCIDENT_ROLES)!;
    const incidentA = repo.create(tenantA, 20)!;
    const incidentB = repo.create(global, 20)!;

    assert.deepEqual(repo.list(tenantA).map((incident) => incident.id), [incidentA.id]);
    assert.equal(repo.update(tenantA, incidentB.id, "RESOLVED"), undefined);
    assert.equal(repo.delete(tenantA, incidentB.id), undefined);
    assert.equal(repo.update(tenantA, incidentA.id, "RESOLVED")?.status, "RESOLVED");
    assert.equal(repo.delete(tenantA, incidentA.id)?.id, incidentA.id);
  });
});