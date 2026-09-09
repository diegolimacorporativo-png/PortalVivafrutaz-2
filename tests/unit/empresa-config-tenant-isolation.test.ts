/**
 * Empresa-config tenant isolation tests.
 *
 * These tests exercise the authorization and body-boundary policy with an
 * in-memory repository fake. They never connect to or mutate Supabase.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "../../server/core/http/requireAuth";
import {
  resolveEmpresaConfigAccess,
  sanitizeEmpresaConfigBody,
} from "../../server/routes/empresa-config.policy";

type Config = {
  empresaId: number;
  corPrimaria: string;
};

function makeFakeRepository(initial: Config[]) {
  const configs = new Map(initial.map((config) => [config.empresaId, { ...config }]));

  return {
    get(empresaId: number) {
      return configs.get(empresaId);
    },
    update(empresaId: number, body: Record<string, unknown>) {
      const existing = configs.get(empresaId);
      if (!existing) return undefined;
      const safeBody = sanitizeEmpresaConfigBody(body);
      const updated = { ...existing, ...safeBody, empresaId };
      configs.set(empresaId, updated as Config);
      return updated;
    },
    snapshot() {
      return Array.from(configs.values()).map((config) => ({ ...config }));
    },
  };
}

const tenantA = { role: "ADMIN", empresaId: 10 };
const tenantB = { role: "ADMIN", empresaId: 20 };
const globalMaster = { role: "MASTER", empresaId: null };
const globalDirector = { role: "DIRECTOR", empresaId: null };
const globalAdmin = { role: "ADMIN", empresaId: null };

describe("empresa-config — isolamento multi-tenant", () => {
  test("tenant A pode consultar a configuração A", () => {
    assert.deepEqual(resolveEmpresaConfigAccess(tenantA, 10), {
      allowed: true,
      tenantId: 10,
    });
  });

  test("tenant A não pode consultar a configuração B", () => {
    const access = resolveEmpresaConfigAccess(tenantA, 20);
    assert.equal(access.allowed, false);
    assert.equal(access.status, 404);
  });

  test("tenant A pode atualizar a configuração A", () => {
    assert.deepEqual(resolveEmpresaConfigAccess(tenantA, 10), {
      allowed: true,
      tenantId: 10,
    });
  });

  test("tenant A não pode atualizar a configuração B", () => {
    const access = resolveEmpresaConfigAccess(tenantA, 20);
    assert.equal(access.allowed, false);
    assert.equal(access.status, 404);
  });

  test("empresaId/tenantId/companyId no body nunca alteram o tenant", () => {
    const repo = makeFakeRepository([
      { empresaId: 10, corPrimaria: "#111111" },
      { empresaId: 20, corPrimaria: "#222222" },
    ]);

    repo.update(10, {
      corPrimaria: "#333333",
      empresaId: 20,
      empresa_id: 20,
      companyId: 20,
      tenantId: 20,
    });

    assert.deepEqual(repo.get(10), {
      empresaId: 10,
      corPrimaria: "#333333",
    });
    assert.deepEqual(repo.get(20), {
      empresaId: 20,
      corPrimaria: "#222222",
    });
  });

  test("tenant B não pode acessar a configuração A", () => {
    const access = resolveEmpresaConfigAccess(tenantB, 10);
    assert.equal(access.allowed, false);
    assert.equal(access.status, 404);
  });

  test("usuário sem sessão recebe 401 pelo middleware de autenticação", () => {
    const req = { session: undefined } as any;
    let nextError: any;
    requireAuth(req, {} as any, (error?: unknown) => {
      nextError = error;
    });
    assert.equal(nextError?.status, 401);
  });

  test("usuário autenticado sem role necessária recebe 403", () => {
    const access = resolveEmpresaConfigAccess({ empresaId: 10 }, 10);
    assert.equal(access.allowed, false);
    assert.equal(access.status, 403);
  });

  test("usuário global autorizado pode acessar tenant selecionado", () => {
    assert.deepEqual(resolveEmpresaConfigAccess(globalMaster, 20), {
      allowed: true,
      tenantId: null,
    });
    assert.deepEqual(resolveEmpresaConfigAccess(globalDirector, 10), {
      allowed: true,
      tenantId: null,
    });
  });

  test("ADMIN tenant-bound não pode selecionar empresa arbitrária", () => {
    const access = resolveEmpresaConfigAccess(tenantA, 20);
    assert.equal(access.allowed, false);
    assert.equal(access.status, 404);
  });

  test("usuário sem tenant e sem role global recebe 403", () => {
    const access = resolveEmpresaConfigAccess(globalAdmin, 10);
    assert.equal(access.allowed, false);
    assert.equal(access.status, 403);
  });

  test("nenhuma configuração existente é alterada por tentativa bloqueada", () => {
    const repo = makeFakeRepository([
      { empresaId: 10, corPrimaria: "#111111" },
      { empresaId: 20, corPrimaria: "#222222" },
    ]);
    const before = repo.snapshot();
    const access = resolveEmpresaConfigAccess(tenantA, 20);

    assert.equal(access.allowed, false);
    assert.deepEqual(repo.snapshot(), before);
  });
});