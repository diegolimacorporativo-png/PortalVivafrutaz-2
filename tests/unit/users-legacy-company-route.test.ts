import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { mock, test } from "node:test";
import { USER_ROLE_VALUES } from "../../shared/user-roles";

process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

const [{ usersRouter }, { usersService }, { storage }, { getTenantContext }] = await Promise.all([
  import("../../server/modules/users/users.routes"),
  import("../../server/modules/users/users.service"),
  import("../../server/services/storage"),
  import("../../server/core/tenant/context"),
]);

async function withUsersApi<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const testSession = req.header("x-test-session");
    req.session = testSession ? JSON.parse(testSession) : undefined;
    next();
  });
  app.use("/api/users", usersRouter);
  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error.status ?? 500).json({ message: error.message });
  });

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Servidor de teste sem endereço TCP");

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("gestores autorizados vinculados à Empresa A podem atribuir todos os perfis internos sem vínculo", async () => {
  const persisted: any[] = [];
  const contexts: any[] = [];
  const originalRepo = (usersService as any).repo;
  (usersService as any).repo = {
    create: async (input: any) => {
      persisted.push(input);
      contexts.push(getTenantContext());
      return { ...input, id: 900 };
    },
  };

  try {
    await withUsersApi(async (baseUrl) => {
      for (const [index, managerRole] of ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"].entries()) {
        const userLookup = mock.method(storage, "getUser", async (id: number) => ({
          id,
          name: "Gestor interno",
          email: "gestor@example.test",
          role: managerRole,
          empresaId: 10,
          active: true,
        } as any));

        try {
          for (const [roleIndex, role] of USER_ROLE_VALUES.entries()) {
            const response = await fetch(`${baseUrl}/api/users`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-test-session": JSON.stringify({ userId: 31 + index, userRole: managerRole }),
                "x-empresa-id": "20",
              },
              body: JSON.stringify({
                name: "Funcionário interno",
                email: `interno-${managerRole.toLowerCase()}-${roleIndex}@example.test`,
                password: "Senha-sintetica-123!",
                role,
                empresaId: 20,
              }),
            });

            assert.equal(response.status, 201, `${managerRole} vinculado à Empresa A deve poder atribuir ${role}`);
            const result = await response.json() as any;
            assert.equal(result.empresaId, null);
            assert.equal(result.role, role);
          }
        } finally {
          userLookup.mock.restore();
        }
      }
    });
  } finally {
    (usersService as any).repo = originalRepo;
  }

  assert.equal(persisted.length, USER_ROLE_VALUES.length * 4);
  assert.ok(persisted.every((user) => user.empresaId === null));
  assert.ok(contexts.every((context) => context?.empresaId === null));
  assert.ok(contexts.every((context) => context?.principal?.empresaId === null));
});

test("perfil interno sem autorização administrativa continua bloqueado na API de usuários", async () => {
  const originalRepo = (usersService as any).repo;
  let createCalls = 0;
  (usersService as any).repo = {
    create: async (input: any) => {
      createCalls += 1;
      return { ...input, id: 901 };
    },
  };
  const userLookup = mock.method(storage, "getUser", async (id: number) => ({
    id,
    role: "LOGISTICS",
    empresaId: 10,
    active: true,
  } as any));
  const companyLookup = mock.method(storage, "getCompany", async (id: number) => ({
    id,
    active: true,
  } as any));

  try {
    await withUsersApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-session": JSON.stringify({ userId: 41, userRole: "LOGISTICS" }),
        },
        body: JSON.stringify({
          name: "Usuário sem autorização",
          email: "sem-permissao@example.test",
          password: "Senha-sintetica-123!",
          role: "COMERCIAL",
        }),
      });

      assert.equal(response.status, 403);
      assert.equal(createCalls, 0);
    });
  } finally {
    companyLookup.mock.restore();
    userLookup.mock.restore();
    (usersService as any).repo = originalRepo;
  }
});

test("contas de clientes continuam fora da API de usuários internos", async () => {
  let createCalls = 0;
  const originalRepo = (usersService as any).repo;
  (usersService as any).repo = {
    create: async (input: any) => {
      createCalls += 1;
      return { ...input, id: 902 };
    },
  };
  const companyLookup = mock.method(storage, "getCompany", async (id: number) => ({
    id,
    active: true,
  } as any));

  try {
    await withUsersApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-session": JSON.stringify({ companyId: 10 }),
        },
        body: JSON.stringify({
          name: "Conta cliente",
          email: "cliente@example.test",
          password: "Senha-sintetica-123!",
          role: "COMERCIAL",
        }),
      });

      assert.equal(response.status, 401);
      assert.equal(createCalls, 0);
    });
  } finally {
    companyLookup.mock.restore();
    (usersService as any).repo = originalRepo;
  }
});
