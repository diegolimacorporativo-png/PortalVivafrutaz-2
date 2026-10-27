import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { requireTabPermission } from "../../server/middleware/requireTabPermission";
import { storage } from "../../server/services/storage";
import { ForbiddenError } from "../../server/shared/errors/AppError";
import { driverTabForRequest } from "../../server/modules/logistics/driver.access";

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

  test("conta cliente mantém o próprio fluxo; MASTER, ADMIN e DIRECTOR não são bloqueados por abas", async () => {
    let nextCalled = false;
    await requireTabPermission("finance")({ session: { companyId: 5 } } as any, {} as any, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    for (const [index, role] of ["MASTER", "ADMIN", "DIRECTOR"].entries()) {
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

  test("DEVELOPER respeita restrição de aba, mantendo seu escopo global separado", async () => {
    const lookup = mock.method(storage, "getUser", async () => ({ id: 4, role: "DEVELOPER", active: true, tabPermissions: ["__deny_all_tabs__"] } as any));
    try {
      let nextError: unknown;
      await requireTabPermission("logistics")({ session: { userId: 4 } } as any, {} as any, (error?: unknown) => { nextError = error; });
      assert.ok(nextError instanceof ForbiddenError);
    } finally { lookup.mock.restore(); }
  });

  test("LOGISTICS sempre mantém a aba de GPS, mesmo com lista antiga restritiva", async () => {
    const lookup = mock.method(storage, "getUser", async () => ({ id: 7, role: "LOGISTICS", active: true, tabPermissions: ["__deny_all_tabs__"] } as any));
    try {
      let nextError: unknown;
      await requireTabPermission("gps-tracking")({ session: { userId: 7 } } as any, {} as any, (error?: unknown) => { nextError = error; });
      assert.equal(nextError, undefined);
    } finally { lookup.mock.restore(); }
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
});
