import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { authCoreService } from "../../server/core/auth/authCore.service";
import { recordUserLoginSuccess } from "../../server/core/security/userRateLimit";
import { AuthService } from "../../server/modules/auth/auth.service";

function makeUser(role: string, id = 42) {
  return {
    id,
    name: "Conta de teste",
    email: `strategic-${role.toLowerCase()}@example.test`,
    password: "correct-password",
    role,
    active: true,
    isLocked: false,
    loginAttempts: 0,
    tokenVersion: 0,
  };
}

test("MASTER, ADMIN e DIRECTOR não acumulam tentativas nem recebem bloqueio após erros", async () => {
  const rateCheck = mock.method(authCoreService, "checkDbRateLimit", async () => ({
    allowed: false,
    recentFailures: 10,
    retryAfterMs: 60_000,
    riskScore: 100,
  }));
  const recordAttempt = mock.method(authCoreService, "recordAttempt", async () => {});

  try {
    for (const [index, role] of ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"].entries()) {
      const user = makeUser(role, 42 + index);
      const updates: Record<string, unknown>[] = [];
      const logs: Record<string, unknown>[] = [];
      const repository = {
        getUserByEmail: async () => user,
        updateUser: async (_id: number, patch: Record<string, unknown>) => {
          updates.push(patch);
          Object.assign(user, patch);
          return user;
        },
        log: async (entry: Record<string, unknown>) => {
          logs.push(entry);
        },
      } as any;
      const service = new AuthService(repository);

      const outcomes = [];
      for (let i = 0; i < 4; i++) {
        outcomes.push(
          await service.attemptLogin(
            { email: user.email, password: "wrong-password", type: "admin" },
            "192.0.2.10",
          ),
        );
      }

      assert.deepEqual(
        outcomes.map(({ kind, status, message }) => [kind, status, message]),
        Array.from({ length: 4 }, () => [
          "failure",
          401,
          "Usuário ou senha incorretos.",
        ]),
        `${role} deve continuar recebendo falha genérica sem limite de três tentativas`,
      );
      assert.equal(
        updates.every((patch) => patch.loginAttempts === 0 && patch.isLocked === false),
        true,
        `${role} não deve acumular contador nem estado de bloqueio`,
      );
      assert.equal(
        logs.every((entry) => !String(entry.description).includes("/3")),
        true,
        `${role} não deve mostrar contador de bloqueio`,
      );
      recordUserLoginSuccess(`user:${user.id}`);
    }

    assert.equal(rateCheck.mock.callCount(), 0, "contas estratégicas ignoram o gate L2");
    assert.equal(recordAttempt.mock.callCount(), 16, "as tentativas continuam auditáveis");
  } finally {
    rateCheck.mock.restore();
    recordAttempt.mock.restore();
  }
});

test("usuários não estratégicos continuam sendo bloqueados após três senhas incorretas", async () => {
  const rateCheck = mock.method(authCoreService, "checkDbRateLimit", async () => ({
    allowed: true,
    recentFailures: 0,
    riskScore: 0,
  }));
  const recordAttempt = mock.method(authCoreService, "recordAttempt", async () => {});

  try {
    const user = makeUser("FINANCEIRO", 88);
    const updates: Record<string, unknown>[] = [];
    const repository = {
      getUserByEmail: async () => user,
      updateUser: async (_id: number, patch: Record<string, unknown>) => {
        updates.push(patch);
        Object.assign(user, patch);
        return user;
      },
      log: async () => {},
      listUsers: async () => [],
    } as any;
    const service = new AuthService(repository);
    (service as any).notifyAdminsOfLockout = async () => {};

    const outcomes = [];
    for (let i = 0; i < 3; i++) {
      outcomes.push(
        await service.attemptLogin(
          { email: user.email, password: "wrong-password", type: "admin" },
          "192.0.2.11",
        ),
      );
    }

    assert.deepEqual(
      outcomes.map(({ kind, status }) => [kind, status]),
      [
        ["failure", 401],
        ["failure", 401],
        ["failure", 423],
      ],
    );
    assert.equal(user.isLocked, true);
    assert.equal(updates[2].loginAttempts, 3);
    assert.equal(rateCheck.mock.callCount(), 3);
    assert.equal(recordAttempt.mock.callCount(), 3);
  } finally {
    rateCheck.mock.restore();
    recordAttempt.mock.restore();
    recordUserLoginSuccess("user:88");
  }
});