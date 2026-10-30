import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";

process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

const { requireActionPermission } = await import("../../server/middleware/requireActionPermission");
const { storage } = await import("../../server/services/storage");
const { ForbiddenError } = await import("../../server/shared/errors/AppError");

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

  test("bloqueia leitura negada também em chamada direta à API", async () => {
    mock.method(storage, "getUser", async () => ({
      id: 6, role: "LOGISTICS", active: true,
      permissions: { actionOverridesV1: { finance: { read: false } } },
    } as any));
    let nextError: unknown;
    await requireActionPermission("finance")({ method: "GET", originalUrl: "/api/finance/cashflow", session: { userId: 6 } } as any, {} as any, (error?: unknown) => { nextError = error; });
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

  test("LOGISTICS, COMERCIAL e MASTER_COMERCIAL mantêm leitura do GPS apesar de overrides antigos", async () => {
    for (const [index, role] of ["LOGISTICS", "COMERCIAL", "FINANCEIRO", "MASTER_COMERCIAL", "PURCHASE_MANAGER"].entries()) {
      const userId = 8 + index;
      mock.method(storage, "getUser", async () => ({ id: userId, role, active: true, permissions: { actionOverridesV1: { logistics: { read: false } } } } as any));
      let nextError: unknown;
      await requireActionPermission("logistics")({ method: "GET", originalUrl: "/api/logistics/drivers/gps", session: { userId } } as any, {} as any, (error?: unknown) => { nextError = error; });
      assert.equal(nextError, undefined, `${role} deve poder ler o GPS`);
      mock.restoreAll();
    }
  });

  test("perfis com acesso somente de leitura são bloqueados nas APIs de escrita", async () => {
    const cases = [
      ["COMERCIAL", "logistics", "POST", "/api/logistics/routes"],
      ["LOGISTICS", "orders", "POST", "/api/orders"],
      ["LOGISTICS", "quotations", "PATCH", "/api/quotations/2"],
      ["LOGISTICS", "finance", "POST", "/api/finance/cashflow"],
      ["FINANCEIRO", "orders", "PATCH", "/api/orders/2"],
      ["FINANCEIRO", "logistics", "DELETE", "/api/logistics/routes/2"],
      ["FINANCEIRO", "quotations", "POST", "/api/quotations"],
    ] as const;
    for (const [index, [role, module, method, path]] of cases.entries()) {
      mock.method(storage, "getUser", async () => ({ id: index + 30, role, active: true, permissions: null } as any));
      let nextError: unknown;
      await requireActionPermission(module)({ method, originalUrl: path, session: { userId: index + 30 } } as any, {} as any, (error?: unknown) => { nextError = error; });
      assert.ok(nextError instanceof ForbiddenError, `${role} should be denied ${method} ${path}`);
      mock.restoreAll();
    }
  });

  test("FINANCEIRO pode operar na área financeira salvo bloqueio individual", async () => {
    mock.method(storage, "getUser", async () => ({ id: 50, role: "FINANCEIRO", active: true, permissions: null } as any));
    let nextError: unknown;
    await requireActionPermission("finance")({ method: "POST", originalUrl: "/api/finance/cashflow", session: { userId: 50 } } as any, {} as any, (error?: unknown) => { nextError = error; });
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

  test("stop-status exige edição, não apenas criação", async () => {
    mock.method(storage, "getUser", async () => ({
      id: 61, role: "LOGISTICS", active: true,
      permissions: { actionOverridesV1: { logistics: { create: true, edit: false } } },
    } as any));
    let nextError: unknown;
    await requireActionPermission("logistics")({
      method: "POST", originalUrl: "/api/deliveries/12/stop-status", session: { userId: 61 },
    } as any, {} as any, (error?: unknown) => { nextError = error; });
    assert.ok(nextError instanceof ForbiddenError);
  });

  test("stop-status permitido quando a edição individual está autorizada", async () => {
    mock.method(storage, "getUser", async () => ({
      id: 64, role: "LOGISTICS", active: true,
      permissions: { actionOverridesV1: { logistics: { edit: true } } },
    } as any));
    let nextCalled = false;
    await requireActionPermission("logistics")({
      method: "POST", originalUrl: "/api/deliveries/12/stop-status", session: { userId: 64 },
    } as any, {} as any, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  test("route-insertion é consulta e respeita leitura de COMERCIAL", async () => {
    mock.method(storage, "getUser", async () => ({
      id: 62, role: "COMERCIAL", active: true,
      permissions: { actionOverridesV1: { logistics: { read: true, create: false } } },
    } as any));
    let nextCalled = false;
    await requireActionPermission("logistics")({
      method: "POST", originalUrl: "/api/logistics/route-insertion", session: { userId: 62 },
    } as any, {} as any, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  test("transições de pedido respeitam negação individual de edição", async () => {
    for (const path of [
      "/api/orders/9/approve-reopen",
      "/api/orders/9/deny-reopen",
      "/api/orders/9/finalize-edit",
      "/api/orders/9/transition",
    ]) {
      mock.method(storage, "getUser", async () => ({
        id: 63, role: "OPERATIONS_MANAGER", active: true,
        permissions: { actionOverridesV1: { orders: { create: true, edit: false } } },
      } as any));
      let nextError: unknown;
      await requireActionPermission("orders")({
        method: "POST", originalUrl: path, session: { userId: 63 },
      } as any, {} as any, (error?: unknown) => { nextError = error; });
      assert.ok(nextError instanceof ForbiddenError, `${path} deve exigir edição`);
      mock.restoreAll();
    }
  });
});
