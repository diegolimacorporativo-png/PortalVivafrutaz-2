import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { requireTabPermission } from "../../server/middleware/requireTabPermission";
import { storage } from "../../server/services/storage";
import { ForbiddenError } from "../../server/shared/errors/AppError";

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

  test("conta cliente mantém o próprio fluxo; perfil global respeita lista personalizada", async () => {
    let nextCalled = false;
    await requireTabPermission("finance")({ session: { companyId: 5 } } as any, {} as any, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    const lookup = mock.method(storage, "getUser", async () => ({ id: 3, role: "ADMIN", active: true, tabPermissions: ["__deny_all_tabs__"] } as any));
    try {
      let nextError: unknown;
      await requireTabPermission("finance")({ session: { userId: 3 } } as any, {} as any, (error?: unknown) => { nextError = error; });
      assert.ok(nextError instanceof ForbiddenError);
    } finally { lookup.mock.restore(); }
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
});
