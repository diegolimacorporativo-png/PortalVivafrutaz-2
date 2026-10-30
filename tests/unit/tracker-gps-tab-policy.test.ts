import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { requireTabPermission } from "../../server/middleware/requireTabPermission";
import { storage } from "../../server/services/storage";
import { ForbiddenError } from "../../server/shared/errors/AppError";

test("permissão da aba de monitoramento não libera envio GPS pelo painel do motorista", async () => {
  const lookup = mock.method(storage, "getUser", async () => ({
    id: 12,
    role: "LOGISTICS",
    active: true,
    tabPermissions: ["gps-tracking"],
  } as any));
  try {
    let nextError: unknown;
    await requireTabPermission("driver-panel")(
      { method: "POST", path: "/gps", originalUrl: "/api/driver/gps", session: { userId: 12 } } as any,
      {} as any,
      (error?: unknown) => { nextError = error; },
    );
    assert.ok(nextError instanceof ForbiddenError);
  } finally {
    lookup.mock.restore();
  }
});

test("exceção do envio GPS não libera rota nem usuários de outros perfis", async () => {
  for (const request of [
    { role: "LOGISTICS", method: "GET", path: "/api/driver/route-today" },
    { role: "OPERATIONS_MANAGER", method: "POST", path: "/api/driver/gps" },
  ]) {
    const lookup = mock.method(storage, "getUser", async () => ({
      id: 13,
      role: request.role,
      active: true,
      tabPermissions: ["__deny_all_tabs__"],
    } as any));
    try {
      let nextError: unknown;
      await requireTabPermission("driver-panel")(
        { ...request, originalUrl: request.path, session: { userId: 13 } } as any,
        {} as any,
        (error?: unknown) => { nextError = error; },
      );
      assert.ok(nextError instanceof ForbiddenError);
    } finally {
      lookup.mock.restore();
    }
  }
});
