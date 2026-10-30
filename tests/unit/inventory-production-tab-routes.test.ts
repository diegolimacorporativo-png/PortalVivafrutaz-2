import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { afterEach, mock, test } from "node:test";

process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

const [
  { inventoryRouter },
  { productionRouter },
  { inventoryService },
  { productionService },
  { storage },
  { assertProductionTenantScope, productionRepository },
  { runWithTenant },
] = await Promise.all([
  import("../../server/modules/inventory/inventory.routes"),
  import("../../server/modules/production/production.routes"),
  import("../../server/modules/inventory/inventory.service"),
  import("../../server/modules/production/production.service"),
  import("../../server/services/storage"),
  import("../../server/modules/production/production.repository"),
  import("../../server/core/tenant/context"),
]);

afterEach(() => mock.restoreAll());

async function withApi<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const session = req.header("x-test-session");
    (req as any).session = session ? JSON.parse(session) : {};
    next();
  });
  app.use("/api/inventory", inventoryRouter);
  app.use("/api/production", productionRouter);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error?.status ?? 500).json({ message: error?.message ?? "Erro interno" });
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("Inventário e Produção aplicam a aba persistida no endpoint e mantêm o perfil como segundo gate", async () => {
  mock.method(storage, "getUser", async (id: number) => ({
    id,
    role: id === 3 ? "COMERCIAL" : "PURCHASE_MANAGER",
    empresaId: 10,
    active: true,
    tabPermissions: id === 2 ? ["orders"] : ["inventory", "production"],
  } as any));
  mock.method(storage, "getCompany", async () => ({ id: 10, active: true } as any));
  mock.method(inventoryService, "listSettings", async () => []);
  mock.method(productionService, "list", async () => []);

  await withApi(async (baseUrl) => {
    for (const [path, tab] of [["/api/inventory/settings", "inventory"], ["/api/production/batches", "production"]] as const) {
      const allowed = await fetch(`${baseUrl}${path}`, {
        headers: {
          "x-test-session": JSON.stringify({ userId: 1, userRole: "PURCHASE_MANAGER" }),
          "x-empresa-id": "10",
        },
      });
      assert.equal(allowed.status, 200, `${tab}: aba permitida (${await allowed.clone().text()})`);

      const deniedTab = await fetch(`${baseUrl}${path}`, {
        headers: { "x-test-session": JSON.stringify({ userId: 2, userRole: "PURCHASE_MANAGER" }) },
      });
      assert.equal(deniedTab.status, 403, `${tab}: aba negada`);
    }

    const deniedRole = await fetch(`${baseUrl}/api/inventory/settings`, {
      headers: { "x-test-session": JSON.stringify({ userId: 3, userRole: "COMERCIAL" }) },
    });
    assert.equal(deniedRole.status, 403, "perfil sem autorização permanece negado");
  });
});

test("MASTER global seleciona um tenant no servidor; conta cliente não entra nos módulos internos", async () => {
  mock.method(storage, "getUser", async (id: number) => ({
    id,
    role: "MASTER",
    empresaId: null,
    active: true,
    tabPermissions: ["__deny_all_tabs__"],
  } as any));
  mock.method(storage, "getCompany", async (id: number) => ({ id, active: true } as any));
  mock.method(inventoryService, "listSettings", async () => []);

  await withApi(async (baseUrl) => {
    const global = await fetch(`${baseUrl}/api/inventory/settings`, {
      headers: {
        "x-test-session": JSON.stringify({ userId: 4, userRole: "MASTER" }),
        "x-empresa-id": "10",
      },
    });
    assert.equal(global.status, 200);

    const client = await fetch(`${baseUrl}/api/inventory/settings`, {
      headers: { "x-test-session": JSON.stringify({ companyId: 10 }) },
    });
    assert.equal(client.status, 401);
  });
});

test("Produção rejeita LOGISTICS e impede que tenant ausente amplie acesso", async () => {
  mock.method(storage, "getUser", async (id: number) => ({
    id,
    role: id === 11 ? "LOGISTICS" : "PURCHASE_MANAGER",
    empresaId: id === 11 || id === 12 ? null : 10,
    active: true,
    tabPermissions: ["production"],
  } as any));
  mock.method(storage, "getCompany", async (id: number) => ({ id, active: true } as any));
  const list = mock.method(productionService, "list", async () => []);

  await withApi(async (baseUrl) => {
    for (const headers of [
      { "x-test-session": JSON.stringify({ userId: 11, userRole: "LOGISTICS" }) },
      {
        "x-test-session": JSON.stringify({ userId: 11, userRole: "LOGISTICS" }),
        "x-empresa-id": "10",
      },
    ]) {
      const denied = await fetch(`${baseUrl}/api/production/batches`, { headers });
      assert.equal(denied.status, 403, "LOGISTICS não pode acessar Produção, com ou sem empresa selecionada");
    }
    const deniedWrite = await fetch(`${baseUrl}/api/production/batches/generate`, {
      method: "POST",
      headers: {
        "x-test-session": JSON.stringify({ userId: 11, userRole: "LOGISTICS" }),
        "x-empresa-id": "10",
      },
    });
    assert.equal(deniedWrite.status, 403, "LOGISTICS não pode alterar Produção de outra empresa");

    const unboundOperational = await fetch(`${baseUrl}/api/production/batches`, {
      headers: { "x-test-session": JSON.stringify({ userId: 12, userRole: "PURCHASE_MANAGER" }) },
    });
    assert.equal(unboundOperational.status, 403, "perfil operacional sem empresa vinculada não obtém leitura global");
    assert.equal(list.mock.callCount(), 0);
  });
});

test("Produção limita usuário operacional à própria empresa e mantém seleção global explícita", async () => {
  mock.method(storage, "getUser", async (id: number) => ({
    id,
    role: id === 20 ? "MASTER" : "PURCHASE_MANAGER",
    empresaId: id === 20 ? null : 10,
    active: true,
    tabPermissions: id === 21 ? ["orders"] : ["production"],
  } as any));
  mock.method(storage, "getCompany", async (id: number) => ({ id, active: true } as any));
  const calls: Array<number | null> = [];
  mock.method(productionService, "list", async (empresaId: number | null) => {
    calls.push(empresaId);
    return [];
  });
  mock.method(productionService, "getById", async (id: number, empresaId: number | null) => {
    assert.equal(empresaId, 10, "a consulta por ID recebe o tenant validado pelo middleware");
    if (id === 999) throw Object.assign(new Error("Lote não encontrado"), { status: 404 });
    return { id, empresaId } as any;
  });
  mock.method(productionRepository, "updateItemCheck", async (itemId: number) => ({
    id: itemId, checkedQuantity: "1",
  } as any));

  await withApi(async (baseUrl) => {
    const pinnedMismatch = await fetch(`${baseUrl}/api/production/batches`, {
      headers: {
        "x-test-session": JSON.stringify({ userId: 10, userRole: "PURCHASE_MANAGER" }),
        "x-empresa-id": "11",
      },
    });
    assert.equal(pinnedMismatch.status, 403, "empresa vinculada não pode ser substituída");

    const otherCompanyRecord = await fetch(`${baseUrl}/api/production/batches/999`, {
      headers: { "x-test-session": JSON.stringify({ userId: 10, userRole: "PURCHASE_MANAGER" }) },
    });
    assert.equal(otherCompanyRecord.status, 404, "ID não encontrado no tenant da sessão permanece oculto");

    const deniedTab = await fetch(`${baseUrl}/api/production/batches`, {
      headers: { "x-test-session": JSON.stringify({ userId: 21, userRole: "PURCHASE_MANAGER" }) },
    });
    assert.equal(deniedTab.status, 403, "aba Produção explicitamente negada bloqueia a API");

    const globalA = await fetch(`${baseUrl}/api/production/batches`, {
      headers: {
        "x-test-session": JSON.stringify({ userId: 20, userRole: "MASTER" }),
        "x-empresa-id": "10",
      },
    });
    const globalB = await fetch(`${baseUrl}/api/production/batches`, {
      headers: {
        "x-test-session": JSON.stringify({ userId: 20, userRole: "MASTER" }),
        "x-empresa-id": "20",
      },
    });
    const globalRead = await fetch(`${baseUrl}/api/production/batches`, {
      headers: { "x-test-session": JSON.stringify({ userId: 20, userRole: "MASTER" }) },
    });
    assert.equal(globalA.status, 200);
    assert.equal(globalB.status, 200);
    assert.equal(globalRead.status, 200, "leitura global permanece explícita para perfil global autorizado");
    assert.deepEqual(calls, [10, 20, null]);

    const globalWriteWithoutTarget = await fetch(`${baseUrl}/api/production/batch-items/7/check`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-test-session": JSON.stringify({ userId: 20, userRole: "MASTER" }),
      },
      body: JSON.stringify({ checkedQuantity: 1 }),
    });
    assert.equal(globalWriteWithoutTarget.status, 403, "escrita global exige selecionar uma empresa");

    const globalWriteWithTarget = await fetch(`${baseUrl}/api/production/batch-items/7/check`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-test-session": JSON.stringify({ userId: 20, userRole: "MASTER" }),
        "x-empresa-id": "20",
      },
      body: JSON.stringify({ checkedQuantity: 1 }),
    });
    assert.equal(globalWriteWithTarget.status, 200, "perfil global segue podendo operar com tenant explícito");
  });
});

test("escopo de repositório aceita null somente em leitura global e exige tenant em escrita", () => {
  assert.throws(() => assertProductionTenantScope(null), /Contexto de empresa ausente/);

  runWithTenant({
    principal: { kind: "admin", userId: 30, role: "MASTER", empresaId: null },
    empresaId: null,
  }, () => {
    assert.doesNotThrow(() => assertProductionTenantScope(null, "read"));
    assert.throws(() => assertProductionTenantScope(null, "write"), /Selecione uma empresa/);
  });

  runWithTenant({
    principal: { kind: "admin", userId: 31, role: "LOGISTICS", empresaId: null },
    empresaId: null,
  }, () => {
    assert.throws(() => assertProductionTenantScope(null, "read"), /Selecione uma empresa/);
  });

  runWithTenant({
    principal: { kind: "admin", userId: 32, role: "PURCHASE_MANAGER", empresaId: 10 },
    empresaId: 10,
  }, () => {
    assert.throws(() => assertProductionTenantScope(11), /não corresponde ao contexto autorizado/);
    assert.doesNotThrow(() => assertProductionTenantScope(10, "write"));
  });
});
