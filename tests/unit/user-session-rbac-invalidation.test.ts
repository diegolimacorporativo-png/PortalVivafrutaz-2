import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import bcrypt from "bcryptjs";
import { afterEach, mock, test } from "node:test";

process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";
process.env.SECURITY_FLAG_AUDIT_LOG = "false";

const [
  { authCoreService },
  { storage },
  { userUpdateRequiresSessionRevocation },
  { sessionVersionGuard },
  { AuthService },
] = await Promise.all([
  import("../../server/core/auth/authCore.service"),
  import("../../server/services/storage"),
  import("../../server/modules/users/users.session-policy"),
  import("../../server/core/security/sessionGuard"),
  import("../../server/modules/auth/auth.service"),
]);

afterEach(() => mock.restoreAll());

test("mudanças de autorização revogam tokenVersion; edição de nome não", () => {
  for (const update of [
    { role: "LOGISTICS" },
    { active: false },
    { isLocked: true },
    { empresaId: 19 },
    { tabPermissions: ["orders"] },
    { permissions: { actionOverridesV1: { orders: { edit: false } } } },
    { password: "synthetic-password" },
  ]) {
    assert.equal(userUpdateRequiresSessionRevocation(update), true);
  }
  assert.equal(userUpdateRequiresSessionRevocation({ name: "Nome atualizado" }), false);
});

test("sessão antiga é rejeitada após troca de perfil mesmo sem confiar no role do cookie", async () => {
  mock.method(storage, "getUser", async () => ({
    id: 12, role: "COMERCIAL", active: true, isLocked: false, tokenVersion: 4,
  } as any));
  const result = await authCoreService.validateSession({ userId: 12, userRole: "ADMIN", tokenVersion: 4 });
  assert.deepEqual(result, { valid: false, reason: "ROLE_CHANGED" });
});

test("sessão de conta desativada ou bloqueada é rejeitada", async () => {
  for (const account of [
    { id: 13, role: "MASTER", active: false, isLocked: false, tokenVersion: 2 },
    { id: 14, role: "MASTER", active: true, isLocked: true, tokenVersion: 2 },
  ]) {
    mock.method(storage, "getUser", async () => account as any);
    const result = await authCoreService.validateSession({ userId: account.id, userRole: "MASTER", tokenVersion: 2 });
    assert.deepEqual(result, { valid: false, reason: "ACCOUNT_DISABLED" });
    mock.restoreAll();
  }
});

test("revogação existente por tokenVersion continua encerrando sessões", async () => {
  mock.method(storage, "getUser", async () => ({ id: 15, role: "DIRECTOR", active: true, tokenVersion: 8 } as any));
  const result = await authCoreService.validateSession({ userId: 15, userRole: "DIRECTOR", tokenVersion: 7 });
  assert.deepEqual(result, { valid: false, reason: "TOKEN_VERSION_MISMATCH" });
});

async function callSessionGuard(session: Record<string, unknown>): Promise<number> {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = {
      ...session,
      destroy: (callback: (error?: Error) => void) => callback(),
    };
    next();
  });
  app.use(sessionVersionGuard);
  app.get("/api/protected", (_req, res) => res.status(200).json({ ok: true }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/protected`);
    return response.status;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("guard HTTP nega sessão bloqueada, revogada e com perfil antigo; aceita sessão nova", async () => {
  const account: any = {
    id: 40, role: "MASTER", active: true, isLocked: false, tokenVersion: 3,
  };
  mock.method(storage, "getUser", async () => ({ ...account }));
  mock.method(authCoreService, "logSessionInvalidation", async () => undefined);
  const session = { userId: 40, userRole: "MASTER", tokenVersion: 3 };

  assert.equal(await callSessionGuard(session), 200, "sessão atual deve ser aceita");
  account.isLocked = true;
  assert.equal(await callSessionGuard(session), 401, "bloqueio deve impedir a sessão ativa");

  account.isLocked = false;
  account.tokenVersion = 4;
  assert.equal(await callSessionGuard(session), 401, "desbloqueio não pode revalidar token antigo");
  assert.equal(await callSessionGuard({ ...session, tokenVersion: 4 }), 200, "login novo usa a versão atual");

  account.role = "DIRECTOR";
  assert.equal(await callSessionGuard({ ...session, tokenVersion: 4 }), 401, "guard compara o perfil atual com o da sessão");

  account.role = "MASTER";
  account.permissions = { actionOverridesV1: { orders: { edit: false } } };
  account.tokenVersion = 5;
  assert.equal(await callSessionGuard(session), 401, "alteração de permissões revoga a sessão antiga");
  assert.equal(await callSessionGuard({ ...session, tokenVersion: 5 }), 200, "sessão nova pode usar as permissões atuais");
});

function makeStrategicFakeRepository(account: any) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    getUserById: async () => ({ ...account }),
    getCompanyByEmail: async () => undefined,
    getUserByEmail: async () => ({ ...account }),
    updateUser: async (_id: number, changes: Record<string, unknown>) => {
      updates.push({ ...changes });
      Object.assign(account, changes);
      if (userUpdateRequiresSessionRevocation(changes)) account.tokenVersion += 1;
      return { ...account };
    },
    changeUserPasswordAndRevokeSessions: async (_id: number, changes: Record<string, unknown>) => {
      updates.push({ ...changes });
      if (typeof changes.password === "string") account.password = await bcrypt.hash(changes.password, 4);
      Object.assign(account, { ...changes, password: account.password });
      account.tokenVersion += 1;
      return { ...account };
    },
    upgradeLegacyUserPassword: async (_id: number, password: string) => {
      account.password = await bcrypt.hash(password, 4);
      return { ...account };
    },
    log: async () => undefined,
    listStrategicUsersForUnlock: async () => [{
      id: account.id,
      email: account.email,
      role: account.role,
      isLocked: account.isLocked,
      loginAttempts: account.loginAttempts,
      active: account.active,
    }],
    clearAuthAttemptsForUser: async () => undefined,
  };
}

test("login estratégico desbloqueia antes de emitir a nova versão de sessão", async () => {
  const account: any = {
    id: 41,
    name: "Conta sintética",
    email: "master.synthetic@example.invalid",
    role: "MASTER",
    active: true,
    isLocked: true,
    loginAttempts: 3,
    tokenVersion: 7,
    password: await bcrypt.hash("Synthetic-Password-42!", 4),
    passwordChangedAt: new Date(),
  };
  const repo = makeStrategicFakeRepository(account);
  mock.method(storage, "createLog", async () => undefined);
  mock.method(authCoreService, "recordAttempt", async () => undefined);
  mock.method(authCoreService, "logAuthEvent", () => undefined);
  const auth = new AuthService(repo as any, async () => undefined);

  const result = await auth.attemptLogin({
    email: account.email,
    password: "Synthetic-Password-42!",
    type: "admin",
  }, "127.0.0.1");

  assert.equal(result.kind, "admin-success");
  if (result.kind !== "admin-success") return;
  assert.equal(account.isLocked, false);
  assert.equal(account.tokenVersion, 8);
  assert.equal(result.user.tokenVersion, 8, "a sessão recém-criada recebe a versão após o desbloqueio");
  assert.ok(repo.updates.some((update) => update.isLocked === false));
});

test("senha incorreta em conta estratégica ativa preserva tokenVersion e sessão válida", async () => {
  const account: any = {
    id: 43,
    name: "Conta sintética",
    email: "master.active.synthetic@example.invalid",
    role: "MASTER",
    active: true,
    isLocked: false,
    loginAttempts: 0,
    tokenVersion: 12,
    password: await bcrypt.hash("Synthetic-Password-42!", 4),
    passwordChangedAt: new Date(),
  };
  const repo = makeStrategicFakeRepository(account);
  mock.method(authCoreService, "recordAttempt", async () => undefined);
  mock.method(authCoreService, "logAuthEvent", () => undefined);
  mock.method(storage, "getUser", async () => ({ ...account } as any));

  const auth = new AuthService(repo as any, async () => undefined);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await auth.attemptLogin({
      email: account.email,
      password: "wrong-synthetic-password",
      type: "admin",
    }, "127.0.0.1");
    assert.equal(result.kind, "failure");
    assert.equal((result as any).status, 401);
  }

  assert.equal(account.tokenVersion, 12);
  assert.equal(account.isLocked, false);
  assert.ok(repo.updates.every((update) => !Object.hasOwn(update, "isLocked")));
  assert.equal(await callSessionGuard({ userId: 43, userRole: "MASTER", tokenVersion: 12 }), 200);
});

test("manutenção explícita limpa tentativas sem revogar quando a conta já estava desbloqueada", async () => {
  const account: any = {
    id: 44,
    name: "Conta sintética",
    email: "director.unlocked.synthetic@example.invalid",
    role: "DIRECTOR",
    active: true,
    isLocked: false,
    loginAttempts: 2,
    tokenVersion: 14,
  };
  const repo = makeStrategicFakeRepository(account);
  await new AuthService(repo as any, async () => undefined).unlockStrategicAccounts();

  assert.equal(account.isLocked, false);
  assert.equal(account.loginAttempts, 0);
  assert.equal(account.tokenVersion, 14);
  assert.ok(repo.updates.every((update) => !Object.hasOwn(update, "isLocked")));
});

test("desbloqueio explícito também revoga e a sessão antiga não volta", async () => {
  const account: any = {
    id: 42,
    name: "Conta sintética",
    email: "director.synthetic@example.invalid",
    role: "DIRECTOR",
    active: true,
    isLocked: true,
    loginAttempts: 3,
    tokenVersion: 10,
  };
  const repo = makeStrategicFakeRepository(account);
  mock.method(storage, "getUser", async () => ({ ...account }));
  mock.method(authCoreService, "logSessionInvalidation", async () => undefined);

  await new AuthService(repo as any, async () => undefined).unlockStrategicAccounts();

  assert.equal(account.isLocked, false);
  assert.equal(account.tokenVersion, 11);
  assert.equal(await callSessionGuard({ userId: 42, userRole: "DIRECTOR", tokenVersion: 10 }), 401);
  assert.equal(await callSessionGuard({ userId: 42, userRole: "DIRECTOR", tokenVersion: 11 }), 200);
});

test("a preparação de bypass no startup é somente leitura", async () => {
  const account: any = {
    id: 45,
    name: "Conta sintética",
    email: "master.readonly.synthetic@example.invalid",
    role: "MASTER",
    active: true,
    isLocked: true,
    loginAttempts: 3,
    tokenVersion: 15,
  };
  const repo = makeStrategicFakeRepository(account);
  const auth = new AuthService(repo as any, async () => undefined);

  await auth.registerStrategicAccountsForLoginBypass();

  assert.deepEqual(repo.updates, [], "startup não atualiza usuário nem limpa auth_attempts");
  assert.equal(account.isLocked, true);
  assert.equal(account.loginAttempts, 3);
  assert.equal(account.tokenVersion, 15);
});

test("troca própria de senha revoga sessão anterior e permite novo login com a senha nova", async () => {
  const account: any = {
    id: 46,
    name: "Usuário sintético",
    email: "self-password.synthetic@example.invalid",
    role: "MASTER",
    active: true,
    isLocked: false,
    loginAttempts: 0,
    tokenVersion: 20,
    password: await bcrypt.hash("Old-Synthetic-Password-42!", 4),
    passwordChangedAt: new Date(),
  };
  const repo = makeStrategicFakeRepository(account);
  const auth = new AuthService(repo as any, async () => undefined);
  mock.method(storage, "getUser", async () => ({ ...account } as any));
  mock.method(storage, "createLog", async () => undefined);
  mock.method(authCoreService, "recordAttempt", async () => undefined);
  mock.method(authCoreService, "logAuthEvent", () => undefined);
  mock.method(authCoreService, "logSessionInvalidation", async () => undefined);

  const changed = await auth.changePasswordSelf(account.id, "Old-Synthetic-Password-42!", "New-Synthetic-Password-43!", "127.0.0.1");
  assert.deepEqual(changed, { ok: true });
  assert.equal(account.tokenVersion, 21);
  assert.equal(await callSessionGuard({ userId: account.id, userRole: "MASTER", tokenVersion: 20 }), 401);
  assert.equal(await callSessionGuard({ userId: account.id, userRole: "MASTER", tokenVersion: 21 }), 200);

  const login = await auth.attemptLogin({ email: account.email, password: "New-Synthetic-Password-43!", type: "admin" }, "127.0.0.1");
  assert.equal(login.kind, "admin-success");
  if (login.kind === "admin-success") assert.equal(login.user.tokenVersion, 21);
});

test("troca temporária de senha de usuário interno incrementa tokenVersion", async () => {
  const account: any = {
    id: 47,
    name: "Usuário temporário sintético",
    email: "temporary-password.synthetic@example.invalid",
    role: "COMERCIAL",
    active: true,
    isLocked: false,
    loginAttempts: 0,
    tokenVersion: 6,
    password: await bcrypt.hash("Temporary-Synthetic-42!", 4),
    mustChangePassword: true,
    passwordTemporary: true,
    passwordChangedAt: null,
  };
  const repo = makeStrategicFakeRepository(account);
  const auth = new AuthService(repo as any, async () => undefined);
  mock.method(authCoreService, "recordAttempt", async () => undefined);
  mock.method(authCoreService, "logAuthEvent", () => undefined);

  const result = await auth.forcePasswordChange(
    account.email,
    "Temporary-Synthetic-42!",
    "New-Temporary-Synthetic-43!",
    "127.0.0.1",
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(account.tokenVersion, 7);
  assert.equal(account.mustChangePassword, false);
  assert.equal(await bcrypt.compare("New-Temporary-Synthetic-43!", account.password), true);
});
