/**
 * Users CRUD tenant-isolation tests.
 *
 * These tests exercise the service boundary with an in-memory repository fake.
 * They never connect to or mutate the shared development/production database.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

const { UsersService } = await import("../../server/modules/users/users.service");
const { runWithTenant } = await import("../../server/core/tenant/context");
const { USER_ROLE_VALUES } = await import("../../shared/user-roles");
const { ConflictError, NotFoundError } = await import("../../server/shared/errors/AppError");

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
    updateForTarget: [],
    changePasswordForTarget: [],
    unlockUserForTarget: [],
    delete: [],
    deleteUserForTarget: [],
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
    updateUserForTarget: async (id: number, empresaId: number | null, input: any) => {
      calls.updateForTarget.push([id, empresaId, input]);
      return overrides.updateUserForTarget
        ? overrides.updateUserForTarget(id, empresaId, input)
        : { ...target, ...input, id, empresaId };
    },
    changePasswordForTarget: async (id: number, password: string, empresaId: number | null) => {
      calls.changePasswordForTarget.push([id, password, empresaId]);
      return overrides.changePasswordForTarget
        ? overrides.changePasswordForTarget(id, password, empresaId)
        : { ...target, id, empresaId };
    },
    unlockUserForTarget: async (id: number, empresaId: number | null) => {
      calls.unlockUserForTarget.push([id, empresaId]);
      return overrides.unlockUserForTarget
        ? overrides.unlockUserForTarget(id, empresaId)
        : { ...target, id, empresaId, isLocked: false, loginAttempts: 0 };
    },
    delete: async (id: number) => {
      calls.delete.push(id);
      if (overrides.delete) return overrides.delete(id);
    },
    deleteUserForTarget: async (id: number, empresaId: number | null) => {
      calls.deleteUserForTarget.push([id, empresaId]);
      return overrides.deleteUserForTarget
        ? overrides.deleteUserForTarget(id, empresaId)
        : true;
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

function withGlobalAdmin<T>(role: "MASTER" | "DIRECTOR" | "DEVELOPER", fn: () => Promise<T>) {
  return runWithTenant(
    { principal: { kind: "admin", empresaId: null, userId: actor.id, role }, empresaId: null },
    fn,
  );
}

function withGlobalAdminTarget<T>(role: "MASTER" | "DIRECTOR" | "DEVELOPER", empresaId: number, fn: () => Promise<T>) {
  return runWithTenant(
    { principal: { kind: "admin", empresaId, userId: actor.id, role }, empresaId },
    fn,
  );
}

describe("UsersService — isolamento multi-tenant", () => {
  test("troca administrativa usa atualização que revoga sessões do alvo", async () => {
    const { service, calls } = makeService({
      getById: (id: number) => id === actor.id ? actor : target,
    });

    await withGlobalAdmin("DIRECTOR", async () => {
      await service.changePassword({
        targetUserId: target.id,
        newPassword: "Senha-Sintetica-42!",
        actorUserId: actor.id,
        ip: "127.0.0.1",
      });
    });

    assert.deepEqual(calls.changePasswordForTarget, [[target.id, "Senha-Sintetica-42!", target.empresaId]]);
  });

  test("persiste overrides de ação sem descartar configurações legadas", async () => {
    const legacy = { oldPermissionSet: ["keep-me"], actionOverridesV1: { orders: { read: false } } };
    const { service, calls } = makeService({
      getById: async () => ({ ...target, permissions: legacy }),
    });

    await withTenant(10, async () => {
      await service.update(20, {
        permissions: { actionOverridesV1: { quotations: { delete: false } } },
      } as any);
    });

    assert.deepEqual(calls.update[0][1].permissions, {
      oldPermissionSet: ["keep-me"],
      actionOverridesV1: { quotations: { delete: false } },
    });
  });

  test("remover overrides não remove os demais dados legados de permissions", async () => {
    const legacy = { oldPermissionSet: ["keep-me"], actionOverridesV1: { orders: { read: false } } };
    const { service, calls } = makeService({
      getById: async () => ({ ...target, permissions: legacy }),
    });

    await withTenant(10, async () => {
      await service.update(20, { permissions: null } as any);
    });

    assert.deepEqual(calls.update[0][1].permissions, { oldPermissionSet: ["keep-me"] });
  });

  test("usuário interno autorizado é criado sem vínculo, ignorando tenant e empresaId do body", async () => {
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

    assert.equal(calls.create[0].empresaId, null);
  });

  test("gestor global edita usuário interno sem selecionar empresa", async () => {
    const unboundTarget = { ...target, empresaId: null, role: "COMERCIAL" };
    const { service, calls } = makeService({
      getById: async () => unboundTarget,
    });

    await withGlobalAdmin("DIRECTOR", async () => {
      await service.update(unboundTarget.id, { name: "Funcionário atualizado" });
    });

    assert.deepEqual(calls.updateForTarget, [[unboundTarget.id, null, { name: "Funcionário atualizado" }]]);
  });

  for (const role of ["MASTER", "DIRECTOR"] as const) {
    test(`${role} ignora o tenant operacional ao criar uma identidade interna`, async () => {
      const { service, calls } = makeService();

      await withGlobalAdminTarget(role, 55, async () => {
        await service.create({
          name: "Novo usuário",
          email: "novo@example.com",
          password: "a-strong-test-password",
          role: "ADMIN",
          empresaId: 99,
        } as any);
      });

      assert.equal(calls.create[0].empresaId, null);
    });
  }

  for (const role of USER_ROLE_VALUES) {
    test(`${role} pode ser cadastrado sem vínculo permanente por um gestor global`, async () => {
      const { service, calls } = makeService();
      await withGlobalAdmin("DIRECTOR", async () => {
        await service.create({
          name: "Funcionário interno",
          email: `${role.toLowerCase()}@example.com`,
          password: "a-strong-test-password",
          role,
          empresaId: 99,
        } as any);
      });
      assert.equal(calls.create[0].empresaId, null);
    });
  }

  test("DEVELOPER global cria conta interna e seleciona o perfil explicitamente autorizado", async () => {
    const { service, calls } = makeService();
    await withGlobalAdmin("DEVELOPER", async () => {
      await service.create({
        name: "Funcionário interno",
        email: "developer-created-staff@example.com",
        password: "a-strong-test-password",
        role: "COMERCIAL",
        empresaId: 99,
      } as any);
      await service.create({
        name: "Administrador global de teste",
        email: "developer-created-director@example.com",
        password: "another-strong-test-password",
        role: "DIRECTOR",
      } as any);
    });
    assert.equal(calls.create[0].empresaId, null);
    assert.equal(calls.create[1].role, "DIRECTOR");
    assert.equal(calls.create[1].empresaId, null);
  });

  test("ADMIN com contexto operacional cria funcionário sem vínculo permanente", async () => {
    const { service, calls } = makeService();
    await withTenant(10, async () => {
      await service.create({
        name: "Funcionário da empresa",
        email: "staff@example.com",
        password: "a-strong-test-password",
        role: "LOGISTICS",
        empresaId: 99,
      } as any);
    });
    assert.equal(calls.create[0].empresaId, null);
  });

  test("tenant A atualiza somente com empresaId do tenant A", async () => {
    const { service, calls } = makeService();

    await withTenant(10, async () => {
      await service.update(20, { role: "LOGISTICS", empresaId: 99 } as any);
    });

    assert.equal(calls.update[0][0], 20);
    assert.equal(calls.update[0][1].empresaId, 10);
  });

  test("perfil e permissões de funcionário sem empresa podem ser editados sem tenant-alvo", async () => {
    const unboundTarget = { ...target, empresaId: null, role: "COMERCIAL", permissions: null };
    const { service, calls } = makeService({ getById: async () => unboundTarget });

    await withGlobalAdmin("DIRECTOR", async () => {
      await service.update(target.id, {
        role: "FINANCEIRO",
        permissions: { actionOverridesV1: { finance: { read: false } } },
      } as any);
    });

    assert.equal(calls.updateForTarget.length, 1);
    assert.equal(calls.updateForTarget[0][1], null);
    assert.equal(calls.updateForTarget[0][2].role, "FINANCEIRO");
    assert.deepEqual(calls.updateForTarget[0][2].permissions, {
      actionOverridesV1: { finance: { read: false } },
    });
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

  test("exclusão com registros relacionados informa que o usuário deve ser desativado", async () => {
    const { service, calls } = makeService({
      delete: async () => { throw { code: "23503" }; },
    });

    await withTenant(10, async () => {
      await assert.rejects(
        () => service.delete(target.id),
        (error: any) => error instanceof ConflictError &&
          error.status === 409 && error.message.includes("Desative a conta"),
      );
    });
    assert.deepEqual(calls.delete, [target.id]);
  });

  for (const role of ["MASTER", "DIRECTOR"] as const) {
    test(`${role} global exclui o usuário explícito no tenant obtido do cadastro`, async () => {
      const globalActor = { ...actor, role, empresaId: null };
      const targetInOtherTenant = { ...target, empresaId: 55 };
      const { service, calls } = makeService({
        getById: (id: number) =>
          id === globalActor.id ? globalActor : targetInOtherTenant,
      });

      await withGlobalAdmin(role, async () => {
        await service.delete(targetInOtherTenant.id);
      });

      assert.deepEqual(calls.deleteUserForTarget, [[target.id, 55]]);
      assert.deepEqual(calls.delete, []);
    });
  }

  test("exclusão global falha fechada se o tenant do alvo mudar durante a operação", async () => {
    const globalActor = { ...actor, role: "MASTER", empresaId: null };
    const targetInOtherTenant = { ...target, empresaId: 55 };
    const { service, calls } = makeService({
      getById: (id: number) =>
        id === globalActor.id ? globalActor : targetInOtherTenant,
      deleteUserForTarget: () => false,
    });

    await withGlobalAdmin("MASTER", async () => {
      await assert.rejects(
        () => service.delete(targetInOtherTenant.id),
        (error: any) => error instanceof NotFoundError && error.status === 404,
      );
    });

    assert.deepEqual(calls.deleteUserForTarget, [[target.id, 55]]);
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
    assert.equal(calls.unlockUserForTarget.length, 0);
  });

  test("ADMIN do tenant desbloqueia usuário da própria empresa", async () => {
    const { service, calls } = makeService({
      getById: (id: number) => (id === actor.id ? actor : target),
    });

    await withTenant(10, async () => {
      await service.unlockUser({
        targetUserId: target.id,
        actorUserId: actor.id,
        ip: "test",
      });
    });

    assert.deepEqual(calls.unlockUserForTarget, [[target.id, 10]]);
    assert.equal(calls.log.at(-1)?.action, "ACCOUNT_UNLOCKED");
  });

  for (const role of ["MASTER", "DIRECTOR"] as const) {
    test(`${role} global desbloqueia usuário pelo ID explícito e empresa confiável`, async () => {
      const globalActor = { ...actor, role, empresaId: null };
      const targetInOtherTenant = { ...target, empresaId: 55 };
      const { service, calls } = makeService({
        getById: (id: number) =>
          id === globalActor.id ? globalActor : targetInOtherTenant,
      });

      await withGlobalAdmin(role, async () => {
        await service.unlockUser({
          targetUserId: targetInOtherTenant.id,
          actorUserId: globalActor.id,
          ip: "test",
        });
      });

      assert.deepEqual(calls.unlockUserForTarget, [[20, 55]]);
      assert.equal(calls.log.at(-1)?.action, "ACCOUNT_UNLOCKED");
    });
  }

  test("não registra desbloqueio se o usuário mudar de empresa antes da atualização", async () => {
    const globalActor = { ...actor, role: "MASTER", empresaId: null };
    const targetInOtherTenant = { ...target, empresaId: 55 };
    const { service, calls } = makeService({
      getById: (id: number) =>
        id === globalActor.id ? globalActor : targetInOtherTenant,
      unlockUserForTarget: () => undefined,
    });

    await withGlobalAdmin("MASTER", async () => {
      await assert.rejects(
        () =>
          service.unlockUser({
            targetUserId: targetInOtherTenant.id,
            actorUserId: globalActor.id,
            ip: "test",
          }),
        (error: any) => error instanceof NotFoundError && error.status === 404,
      );
    });

    assert.equal(calls.log.length, 0);
  });

  test("DIRECTOR global redefine apenas o usuário explícito no tenant confiável do alvo", async () => {
    const globalActor = { ...actor, role: "DIRECTOR", empresaId: null };
    const targetInOtherTenant = { ...target, empresaId: 55 };
    const { service, calls } = makeService({
      getById: (id: number) => (id === globalActor.id ? globalActor : targetInOtherTenant),
    });

    await withGlobalAdmin("DIRECTOR", async () => {
      await service.changePassword({
        targetUserId: targetInOtherTenant.id,
        newPassword: "new-secure-password",
        actorUserId: globalActor.id,
        ip: "test",
      });
    });

    assert.deepEqual(calls.changePasswordForTarget, [[20, "new-secure-password", 55]]);
    assert.equal(calls.log.at(-1)?.action, "PASSWORD_CHANGED");
  });

  test("DIRECTOR global não redefine alvo que mudou de tenant entre leitura e update", async () => {
    const globalActor = { ...actor, role: "DIRECTOR", empresaId: null };
    const targetInOtherTenant = { ...target, empresaId: 55 };
    const { service, calls } = makeService({
      getById: (id: number) => (id === globalActor.id ? globalActor : targetInOtherTenant),
      changePasswordForTarget: () => undefined,
    });

    await withGlobalAdmin("DIRECTOR", async () => {
      await assert.rejects(
        () =>
          service.changePassword({
            targetUserId: targetInOtherTenant.id,
            newPassword: "new-secure-password",
            actorUserId: globalActor.id,
            ip: "test",
          }),
        (error: any) => error instanceof NotFoundError && error.status === 404,
      );
    });

    assert.equal(calls.log.length, 0);
  });
});
