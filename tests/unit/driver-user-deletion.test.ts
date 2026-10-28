import assert from "node:assert/strict";
import { mock, test } from "node:test";

process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

const { db } = await import("../../server/database/db");
const { UsersRepository } = await import("../../server/modules/users/users.repository");

test("excluir login de motorista desativa o cadastro operacional na mesma transação", async () => {
  const operations: Array<{ kind: string; values?: unknown }> = [];
  const target = { role: "MOTORISTA", email: "driver@example.test", empresaId: 25 };
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [target] }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({ where: async () => { operations.push({ kind: "deactivate", values }); } }),
    }),
    delete: () => ({
      where: () => ({ returning: async () => { operations.push({ kind: "delete-user" }); return [{ id: 51, empresaId: 25 }]; } }),
    }),
  };
  const transaction = mock.method(db, "transaction", async (callback: any) => callback(tx as any));
  try {
    await new UsersRepository().deleteUser(51);
    assert.deepEqual(operations, [
      { kind: "deactivate", values: { active: false } },
      { kind: "delete-user" },
    ]);
  } finally {
    transaction.mock.restore();
  }
});
