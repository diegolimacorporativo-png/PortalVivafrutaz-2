import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { ForbiddenError } from "../../server/shared/errors/AppError";

process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

const [{ requireTabPermission }, { storage }, { driverTabForRequest }] = await Promise.all([
  import("../../server/middleware/requireTabPermission"),
  import("../../server/services/storage"),
  import("../../server/modules/logistics/driver.access"),
]);

describe("permissões personalizadas de abas no backend", () => {
  test("aba persistida permite entrada no módulo, sem conceder papel", async () => {
    const lookup = mock.method(storage, "getUser", async () => ({ id: 1, role: "COMERCIAL", active: true, tabPermissions: ["logistics"] } as any));
    try {
      let nextError: unknown;
      await requireTabPermission("logistics")({ session: { userId: 1 }, body: { tabPermissions: ["finance"] } } as any, {} as any, (error?: unknown) => { nextError = error; });
      assert.equal(nextError, undefined);
    } finally { lookup.mock.restore(); }
  });

  test("lista vazia mantém o padrão legado e aba ausente nega sem confiar no body", async () => {
    for (const tabPermissions of [[], ["orders"]]) {
      const lookup = mock.method(storage, "getUser", async () => ({ id: 2, role: "LOGISTICS", active: true, tabPermissions } as any));
      try {
        let nextError: unknown;
        await requireTabPermission("logistics")({ session: { userId: 2 }, body: { tabPermissions: ["logistics"] } } as any, {} as any, (error?: unknown) => { nextError = error; });
        if (tabPermissions.length === 0) assert.equal(nextError, undefined);
        else assert.ok(nextError instanceof ForbiddenError);
      } finally { lookup.mock.restore(); }
    }
  });

  test("marcador explícito nega todas as abas", async () => {
    const lookup = mock.method(storage, "getUser", async () => ({ id: 6, role: "LOGISTICS", active: true, tabPermissions: ["__deny_all_tabs__"] } as any));
    try {
      let nextError: unknown;
      await requireTabPermission("logistics")({ session: { userId: 6 } } as any, {} as any, (error?: unknown) => { nextError = error; });
      assert.ok(nextError instanceof ForbiddenError);
    } finally { lookup.mock.restore(); }
  });

  test("conta cliente mantém o próprio fluxo; perfis de acesso total não são bloqueados por abas", async () => {
    let nextCalled = false;
    await requireTabPermission("finance")({ session: { companyId: 5 } } as any, {} as any, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    for (const [index, role] of ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"].entries()) {
      const lookup = mock.method(storage, "getUser", async () => ({ id: index + 3, role, active: true, tabPermissions: ["__deny_all_tabs__"] } as any));
      try {
        let nextError: unknown;
        await requireTabPermission("finance")({ session: { userId: index + 3 } } as any, {} as any, (error?: unknown) => { nextError = error; });
        assert.equal(nextError, undefined, `${role} não deve ser bloqueado por tabPermissions`);
      } finally { lookup.mock.restore(); }
    }
  });

  test("ADMIN sem personalização usa as políticas padrão do perfil", async () => {
    const lookup = mock.method(storage, "getUser", async () => ({ id: 5, role: "ADMIN", active: true, tabPermissions: null } as any));
    try {
      let nextError: unknown;
      await requireTabPermission("orders")({ session: { userId: 5 } } as any, {} as any, (error?: unknown) => { nextError = error; });
      assert.equal(nextError, undefined);
    } finally { lookup.mock.restore(); }
  });

  test("DEVELOPER mantém acesso às abas do sistema mesmo com restrição antiga persistida", async () => {
    const lookup = mock.method(storage, "getUser", async () => ({ id: 4, role: "DEVELOPER", active: true, tabPermissions: ["__deny_all_tabs__"] } as any));
    try {
      let nextError: unknown;
      await requireTabPermission("logistics")({ session: { userId: 4 } } as any, {} as any, (error?: unknown) => { nextError = error; });
      assert.equal(nextError, undefined);
    } finally { lookup.mock.restore(); }
  });

  test("LOGISTICS, COMERCIAL e MASTER_COMERCIAL mantêm a aba GPS apesar de listas antigas", async () => {
    for (const [index, role] of ["LOGISTICS", "COMERCIAL", "MASTER_COMERCIAL"].entries()) {
      const userId = 7 + index;
      const lookup = mock.method(storage, "getUser", async () => ({ id: userId, role, active: true, tabPermissions: ["__deny_all_tabs__"] } as any));
      try {
        let nextError: unknown;
        await requireTabPermission("gps-tracking")({ session: { userId } } as any, {} as any, (error?: unknown) => { nextError = error; });
        assert.equal(nextError, undefined, `${role} deve manter monitoramento GPS`);
      } finally { lookup.mock.restore(); }
    }
  });

  test("envio GPS do motorista usa a aba do painel, não a aba de monitoramento", () => {
    assert.equal(driverTabForRequest("POST", "/gps"), "driver-panel");
    assert.equal(driverTabForRequest("POST", "/api/driver/gps"), "driver-panel");
    assert.equal(driverTabForRequest("GET", "/api/driver/27/gps"), "gps-tracking");
  });

  test("motorista com painel permitido pode enviar GPS sem receber acesso à aba de monitoramento", async () => {
    mock.method(storage, "getUser", async () => ({ id: 9, role: "MOTORISTA", active: true, tabPermissions: ["driver-panel"] } as any));
    let nextError: unknown;
    await requireTabPermission((req) => driverTabForRequest(req.method, req.path))(
      { method: "POST", path: "/gps", session: { userId: 9 } } as any,
      {} as any,
      (error?: unknown) => { nextError = error; },
    );
    assert.equal(nextError, undefined);
  });

  test("Inventário e Produção permitem a aba persistida e negam a aba explicitamente removida", async () => {
    for (const key of ["inventory", "production"]) {
      const allowedLookup = mock.method(storage, "getUser", async () => ({
        id: 21, role: "PURCHASE_MANAGER", active: true, tabPermissions: [key],
      } as any));
      let allowedError: unknown;
      await requireTabPermission(key)({ session: { userId: 21 } } as any, {} as any, (error?: unknown) => { allowedError = error; });
      assert.equal(allowedError, undefined, `${key} permitido deve passar`);
      allowedLookup.mock.restore();

      const deniedLookup = mock.method(storage, "getUser", async () => ({
        id: 22, role: "PURCHASE_MANAGER", active: true, tabPermissions: ["orders"],
      } as any));
      let deniedError: unknown;
      await requireTabPermission(key)({ session: { userId: 22 } } as any, {} as any, (error?: unknown) => { deniedError = error; });
      assert.ok(deniedError instanceof ForbiddenError, `${key} negado deve falhar`);
      deniedLookup.mock.restore();
    }
  });

  test("contas globais autorizadas mantêm Inventário e Produção; sessão de cliente segue o gate próprio", async () => {
    for (const [index, role] of ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"].entries()) {
      const lookup = mock.method(storage, "getUser", async () => ({
        id: 30 + index, role, active: true, tabPermissions: ["__deny_all_tabs__"],
      } as any));
      for (const key of ["inventory", "production"]) {
        let error: unknown;
        await requireTabPermission(key)({ session: { userId: 30 + index } } as any, {} as any, (nextError?: unknown) => { error = nextError; });
        assert.equal(error, undefined, `${role} deve manter ${key}`);
      }
      lookup.mock.restore();
    }

    let clientNext = false;
    await requireTabPermission("inventory")({ session: { companyId: 55 } } as any, {} as any, () => { clientNext = true; });
    assert.equal(clientNext, true, "o middleware de aba preserva o gate de sessão de cliente");
  });
});
