/**
 * Users CRUD tenant-isolation tests.
 *
 * These tests exercise the service boundary with an in-memory repository fake.
 * They never connect to or mutate the shared development/production database.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { UsersService } from "../../server/modules/users/users.service";
import { runWithTenant } from "../../server/core/tenant/context";
import { NotFoundError } from "../../server/shared/errors/AppError";

const actor = {
  id: 1,
  empresaId: 10,
  name: "Admin A",
  email: "admin-a@example.com",
  role: "ADMIN",
  active: true,
  password: "hash",
} as any;

const target = {
  id: 20,
  empresaId: 10,
  name: "Usuário A",
  email: "user-a@example.com",
  role: "OPERATIONS_MANAGER",
  active: true,
  password: "hash",
} as any;

function makeService(overrides: Record<string, any> = {}) {
  const calls: Record<string, any[]> = {
    create: [],
    update: [],
    delete: [],
    getById: [],
    log: [],
  };
  const fakeRepo = {
    create: async (input: any) => {
      calls.create.push(input);
      return { ...target, ...input, id: 21 };
    },
    update: async (id: number, input: any) => {
      calls.update.push([id, input]);
      return overrides.update
        ? overrides.update(id, input)
        : { ...target, ...input, id };
    },
    delete: async (id: number) => {
      calls.delete.push(id);
    },
    getById: async (id: number) => {
      calls.getById.push(id);
      return overrides.getById ? overrides.getById(id, calls.getById.length) : target;
    },
    log: async (entry: any) => {
      calls.log.push(entry);
    },
  };
  return { service: new UsersService(fakeRepo as any), calls };
}

function withTenant<T>(empresaId: number, fn: () => Promise<T>) {
  return runWithTenant(
    { principal: { kind: "admin", empresaId, userId: actor.id, role: actor.role }, empresaId },
    fn,
  );
}

describe("UsersService — isolamento multi-tenant", () => {
  test("tenant A cria usuário sempre no tenant A, ignorando empresaId do body", async () => {
    const { service, calls } = makeService();

    await withTenant(10, async () => {
      await service.create({
        name: "Novo usuário",
        email: "novo@example.com",
        password: "secret",
        role: "OPERATIONS_MANAGER",
        empresaId: 99,
      } as any);
    });

    assert.equal(calls.create[0].empresaId, 10);
  });

  test("tenant A atualiza somente com empresaId do tenant A", async () => {
    const { service, calls } = makeService();

    await withTenant(10, async () => {
      await service.update(20, { role: "LOGISTICS", empresaId: 99 } as any);
    });

    assert.equal(calls.update[0][0], 20);
    assert.equal(calls.update[0][1].empresaId, 10);
  });

  test("alvo de outro tenant é tratado como não encontrado no update", async () => {
    const { service, calls } = makeService({
      update: () => undefined,
    });

    await withTenant(10, async () => {
      await assert.rejects(
        () => service.update(99, { role: "LOGISTICS" } as any),
        (error: any) => error instanceof NotFoundError && error.status === 404,
      );
    });
    assert.equal(calls.update.length, 1);
    assert.equal(calls.update[0][1].empresaId, 10);
  });

  test("alvo de outro tenant não pode ser excluído", async () => {
    const { service, calls } = makeService({
      getById: () => undefined,
    });

    await withTenant(10, async () => {
      await assert.rejects(
        () => service.delete(99),
        (error: any) => error instanceof NotFoundError && error.status === 404,
      );
    });
    assert.equal(calls.delete.length, 0);
  });

  test("tenant A não pode desbloquear usuário de outro tenant", async () => {
    const { service, calls } = makeService({
      getById: (_id: number, callNumber: number) => callNumber === 1 ? actor : undefined,
    });

    await withTenant(10, async () => {
      await assert.rejects(
        () => service.unlockUser({ targetUserId: 99, actorUserId: actor.id, ip: "test" }),
        (error: any) => error instanceof NotFoundError && error.status === 404,
      );
    });
    assert.equal(calls.update.length, 0);
  });
});