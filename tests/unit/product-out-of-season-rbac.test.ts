import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { afterEach, test, mock } from "node:test";

process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

const [{ productsRouter }, { productService }, { storage }] = await Promise.all([
  import("../../server/modules/products/products.routes"),
  import("../../server/modules/products/products.service"),
  import("../../server/services/storage"),
]);

afterEach(() => mock.restoreAll());

async function callOutOfSeason(session: Record<string, unknown>, body: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = session;
    next();
  });
  app.use("/api/products", productsRouter);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error?.status ?? 500).json({ message: error?.message ?? "Erro interno" });
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    return await fetch(`http://127.0.0.1:${address.port}/api/products/17/out-of-season`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("conta de cliente autenticada não pode alterar estado global de safra", async () => {
  mock.method(storage, "getCompany", async () => ({ id: 55, active: true } as any));
  const response = await callOutOfSeason({ companyId: 55 }, { outOfSeason: true });
  assert.equal(response.status, 403);
});

test("funcionário autorizado altera safra; entrada inválida preserva validação e não grava", async () => {
  mock.method(storage, "getUser", async () => ({ id: 4, role: "ADMIN", empresaId: 55, active: true } as any));
  mock.method(storage, "getCompany", async () => ({ id: 55, active: true } as any));
  const toggle = mock.method(productService, "toggleOutOfSeason", async () => ({ id: 17, outOfSeason: true } as any));

  const allowed = await callOutOfSeason({ userId: 4, userRole: "ADMIN" }, { outOfSeason: true });
  assert.equal(allowed.status, 200);
  assert.equal(toggle.mock.callCount(), 1);

  const invalid = await callOutOfSeason({ userId: 4, userRole: "ADMIN" }, { outOfSeason: "sim" });
  assert.equal(invalid.status, 400);
  assert.equal(toggle.mock.callCount(), 1);
});

test("funcionário sem perfil de catálogo recebe negação", async () => {
  mock.method(storage, "getUser", async () => ({ id: 5, role: "COMERCIAL", empresaId: 55, active: true } as any));
  mock.method(storage, "getCompany", async () => ({ id: 55, active: true } as any));
  const response = await callOutOfSeason({ userId: 5, userRole: "COMERCIAL" }, { outOfSeason: true });
  assert.equal(response.status, 403);
});
