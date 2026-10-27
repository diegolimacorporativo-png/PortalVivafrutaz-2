import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import { requireActionPermission } from "../../server/middleware/requireActionPermission";
import { storage } from "../../server/services/storage";
import { ForbiddenError } from "../../server/shared/errors/AppError";

afterEach(() => mock.restoreAll());

describe("permissões personalizadas por ação", () => {
  test("bloqueia uma ação negada na configuração persistida", async () => {
    mock.method(storage, "getUser", async () => ({
      id: 1, role: "COMERCIAL", active: true,
      permissions: { actionOverridesV1: { orders: { create: false } } },
    } as any));
    let nextError: unknown;
    await requireActionPermission("orders")({ method: "POST", session: { userId: 1 }, body: { permissions: { actionOverridesV1: { orders: { create: true } } } } } as any, {} as any, (error?: unknown) => { nextError = error; });
    assert.ok(nextError instanceof ForbiddenError);
  });

  test("permitir não substitui os middlewares de perfil e tenant", async () => {
    mock.method(storage, "getUser", async () => ({
      id: 2, role: "COMERCIAL", active: true,
      permissions: { actionOverridesV1: { orders: { create: true } } },
    } as any));
    let nextCalled = false;
    await requireActionPermission("orders")({ method: "POST", session: { userId: 2 } } as any, {} as any, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  test("ações POST que editam um recurso usam a permissão de edição", async () => {
    mock.method(storage, "getUser", async () => ({
      id: 5, role: "COMERCIAL", active: true,
      permissions: { actionOverridesV1: { orders: { create: false, edit: true } } },
    } as any));
    let nextCalled = false;
    await requireActionPermission("orders")({ method: "POST", originalUrl: "/api/orders/9/substitute-item", session: { userId: 5 } } as any, {} as any, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  test("preserva valores legados sem namespace e mantém fluxo de clientes", async () => {
    mock.method(storage, "getUser", async () => ({ id: 3, role: "ADMIN", active: true, permissions: ["legacy"] } as any));
    let staffNext = false;
    await requireActionPermission("orders")({ method: "DELETE", session: { userId: 3 } } as any, {} as any, () => { staffNext = true; });
    assert.equal(staffNext, true);
    let clientNext = false;
    await requireActionPermission("orders")({ method: "POST", session: { companyId: 44 } } as any, {} as any, () => { clientNext = true; });
    assert.equal(clientNext, true);
  });

  test("perfis MASTER, ADMIN e DIRECTOR mantêm acesso apesar de bloqueios personalizados", async () => {
    for (const [index, role] of ["MASTER", "ADMIN", "DIRECTOR"].entries()) {
      mock.method(storage, "getUser", async () => ({ id: index + 10, role, active: true, permissions: { actionOverridesV1: { orders: "malformed" } } } as any));
      let nextError: unknown;
      await requireActionPermission("orders")({ method: "GET", session: { userId: index + 10 } } as any, {} as any, (error?: unknown) => { nextError = error; });
      assert.equal(nextError, undefined, `${role} não deve ser bloqueado por permissões personalizadas`);
      mock.restoreAll();
    }
  });

  test("LOGISTICS mantém leitura do GPS mesmo quando a ação logística está bloqueada", async () => {
    mock.method(storage, "getUser", async () => ({ id: 8, role: "LOGISTICS", active: true, permissions: { actionOverridesV1: { logistics: { read: false } } } } as any));
    let nextError: unknown;
    await requireActionPermission("logistics")({ method: "GET", originalUrl: "/api/logistics/drivers/gps", session: { userId: 8 } } as any, {} as any, (error?: unknown) => { nextError = error; });
    assert.equal(nextError, undefined);
  });

  test("GPS enviado pelo dispositivo do motorista não é bloqueado como criação CRUD", async () => {
    mock.method(storage, "getUser", async () => ({
      id: 11, role: "MOTORISTA", active: true,
      permissions: { actionOverridesV1: { logistics: { create: false } } },
    } as any));
    let nextCalled = false;
    await requireActionPermission("logistics")({
      method: "POST",
      originalUrl: "/api/driver/gps",
      session: { userId: 11 },
    } as any, {} as any, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  test("configuração namespaced malformada falha fechada para perfil sem acesso total", async () => {
    mock.method(storage, "getUser", async () => ({ id: 4, role: "COMERCIAL", active: true, permissions: { actionOverridesV1: { orders: "all" } } } as any));
    let nextError: unknown;
    await requireActionPermission("orders")({ method: "GET", session: { userId: 4 } } as any, {} as any, (error?: unknown) => { nextError = error; });
    assert.ok(nextError instanceof ForbiddenError);
  });
});
