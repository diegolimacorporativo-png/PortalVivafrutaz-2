import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { db } from "../../server/database/db";
import { AuthRepository } from "../../server/modules/auth/auth.repository";
import { AuthService } from "../../server/modules/auth/auth.service";
import { hashRecoveryToken } from "../../server/modules/auth/recovery-token";
import { resetPasswordSchema } from "../../server/modules/auth/auth.validation";

const rawToken = "recovery-token-used-only-in-this-test";

test("recovery token digest is one-way and never equals the presented token", () => {
  const digest = hashRecoveryToken(rawToken);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, rawToken);
  assert.equal(digest, hashRecoveryToken(rawToken));
});

test("repository persists only token_hash and consumes it atomically", async () => {
  let inserted: Record<string, unknown> | undefined;
  const insertedRow = {
    id: 1,
    userId: 10,
    companyId: null,
    tokenHash: hashRecoveryToken(rawToken),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  };

  const insertMock = mock.method(db, "insert", () => {
    const builder: any = {
      values(values: Record<string, unknown>) {
        inserted = values;
        return builder;
      },
      returning: async () => [insertedRow],
    };
    return builder;
  });
  const deleteMock = mock.method(db, "delete", () => {
    const builder: any = {
      where: () => builder,
      returning: async () => [insertedRow],
    };
    return builder;
  });

  try {
    const repository = new AuthRepository();
    await repository.createResetToken({
      userId: 10,
      token: rawToken,
      expiresAt: insertedRow.expiresAt,
    });
    assert.ok(inserted);
    assert.equal("token" in inserted!, false);
    assert.equal(inserted!.tokenHash, hashRecoveryToken(rawToken));

    const consumed = await repository.consumeValidResetToken(rawToken);
    assert.deepEqual(consumed, insertedRow);
    assert.equal(insertMock.mock.callCount(), 1);
    assert.equal(deleteMock.mock.callCount(), 1);
  } finally {
    insertMock.mock.restore();
    deleteMock.mock.restore();
  }
});

test("request creates a token without returning or logging the secret", async () => {
  const user = { id: 10, email: "user@example.com" } as any;
  let created: { token: string; userId?: number; companyId?: number; expiresAt: Date } | undefined;
  let sentHtml = "";
  const consoleOutput: string[] = [];
  const logMock = mock.method(console, "log", (...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(" "));
  });
  const sendEmail = async (_to: string, _subject: string, html: string) => {
    sentHtml = html;
    return { sent: true };
  };

  const repository = {
    getUserByEmail: async () => user,
    getCompanyByEmail: async () => undefined,
    createResetToken: async (params: typeof created) => {
      created = params as typeof created;
      return { id: 1 };
    },
  } as any;

  try {
    const result = await new AuthService(repository, sendEmail).requestPasswordReset(user.email);
    assert.equal(result.found, true);
    assert.equal(result.requestId, undefined);
    assert.ok(created?.token);
    assert.equal(JSON.stringify(result).includes(created!.token), false);
    assert.equal(consoleOutput.some((line) => line.includes(created!.token)), false);
    assert.equal(sentHtml.includes(created!.token), true);
  } finally {
    logMock.mock.restore();
  }
});

test("valid reset updates only the token owner and the same token cannot be reused", async () => {
  let available = true;
  const updates: number[] = [];
  const logs: any[] = [];
  const repository = {
    consumeValidResetToken: async () => {
      if (!available) return null;
      available = false;
      return { userId: 10, companyId: null };
    },
    updateUser: async (id: number) => {
      updates.push(id);
      return {};
    },
    getUserById: async () => ({ id: 10, email: "owner@example.com" }),
    log: async (entry: unknown) => {
      logs.push(entry);
    },
  } as any;

  const service = new AuthService(repository);
  const first = await service.resetPassword(rawToken, "safe-password", "127.0.0.1");
  const second = await service.resetPassword(rawToken, "another-password", "127.0.0.1");

  assert.equal(first.ok, true);
  assert.deepEqual(updates, [10]);
  assert.equal(logs.length, 1);
  assert.equal(second.ok, false);
  assert.equal((second as any).status, 400);
});

test("tampered, unknown, and expired tokens return the same generic failure", async () => {
  const repository = {
    consumeValidResetToken: async () => null,
  } as any;
  const service = new AuthService(repository);
  const messages = await Promise.all([
    service.resetPassword("tampered", "safe-password", "127.0.0.1"),
    service.resetPassword("unknown", "safe-password", "127.0.0.1"),
    service.resetPassword("expired", "safe-password", "127.0.0.1"),
  ]);

  assert.deepEqual(
    messages.map((result) => [result.ok, (result as any).status, result.message]),
    [
      [false, 400, "Token inválido ou expirado. Solicite um novo link de recuperação."],
      [false, 400, "Token inválido ou expirado. Solicite um novo link de recuperação."],
      [false, 400, "Token inválido ou expirado. Solicite um novo link de recuperação."],
    ],
  );
});

test("empty or malformed token is rejected before the reset service", () => {
  assert.throws(() => resetPasswordSchema.parse({ token: "", novaSenha: "safe-password" }));
  assert.throws(() => resetPasswordSchema.parse({ token: 123, novaSenha: "safe-password" }));
});