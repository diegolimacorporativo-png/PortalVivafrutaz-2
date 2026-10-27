import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";

process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

const [{ OrdersRepository }, { runWithTenant }, { db }, { storage }] = await Promise.all([
  import("../../server/modules/orders/orders.repository"),
  import("../../server/core/tenant/context"),
  import("../../server/database/db"),
  import("../../server/services/storage"),
]);

function withTenant<T>(role: string, empresaId: number | null, fn: () => Promise<T>) {
  return runWithTenant(
    { principal: { kind: "admin", role, userId: 1, empresaId }, empresaId } as any,
    fn,
  );
}

describe("OrdersRepository — tenant selecionado prevalece sobre papel global", () => {
  test("MASTER selecionado lê somente pelo predicado do tenant, ignorando empresaId do filtro", async () => {
    const rows = [{ id: 7, companyId: 20 }];
    let whereCalled = false;
    const select = mock.method(db, "select", () => ({
      from: () => ({
        where: () => {
          whereCalled = true;
          return { orderBy: async () => rows };
        },
      }),
    } as any));
    const legacyRead = mock.method(storage, "getOrders", async () => [{ id: 99, companyId: 99 }] as any);
    try {
      const result = await withTenant("MASTER", 20, () => new OrdersRepository().list({ empresaId: 99 } as any));
      assert.deepEqual(result, rows);
      assert.equal(whereCalled, true);
      assert.equal(legacyRead.mock.callCount(), 0);
    } finally {
      legacyRead.mock.restore();
      select.mock.restore();
    }
  });

  test("MASTER sem tenant mantém o caminho global explícito", async () => {
    const legacyRead = mock.method(storage, "getOrders", async (empresaId?: number) => [{ id: empresaId ?? 1 }] as any);
    try {
      const result = await withTenant("MASTER", null, () => new OrdersRepository().list());
      assert.deepEqual(result, [{ id: 1 }]);
      assert.equal(legacyRead.mock.callCount(), 1);
    } finally { legacyRead.mock.restore(); }
  });

  test("ID de pedido de outra empresa não passa quando MASTER selecionou um tenant", async () => {
    const orderRead = mock.method(storage, "getOrder", async () => ({ order: { id: 8, companyId: 99 }, items: [] } as any));
    try {
      const result = await withTenant("MASTER", 20, () => new OrdersRepository().get(8));
      assert.equal(result, undefined);
    } finally { orderRead.mock.restore(); }
  });
});
