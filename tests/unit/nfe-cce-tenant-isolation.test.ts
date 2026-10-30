import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { test } from "node:test";

process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

const [
  { nfeCceReadAccess, nfeCceWriteAccess },
  { storage },
] = await Promise.all([
  import("../../server/modules/nfe/nfe-cce-tenant.middleware"),
  import("../../server/services/storage"),
]);

async function request(
  session: Record<string, unknown>,
  method: "GET" | "POST",
  path: string,
  headers: Record<string, string> = {},
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = session;
    next();
  });
  const fiscalCalls = { history: 0, transmit: 0 };

  const register = (router: express.Router) => {
    router.get("/:id/cce", ...nfeCceReadAccess, (_req, res) => {
      fiscalCalls.history++;
      res.json({ success: true, history: [] });
    });
    router.post("/:id/cce", ...nfeCceWriteAccess, (_req, res) => {
      fiscalCalls.transmit++;
      res.json({ success: true });
    });
  };
  const router = express.Router();
  register(router);
  app.use("/api/nfe", router);
  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.status ?? 500).json({ message: error?.message });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: { ...headers, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(method === "POST" ? { body: JSON.stringify({ correcao: "Correção fiscal sintética com tamanho adequado." }) } : {}),
    });
    return { status: response.status, body: await response.json(), fiscalCalls };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("CC-e consulta e transmissão alcançam apenas NF-e vinculada à empresa selecionada", async (t) => {
  t.mock.method(storage, "getUser", async () => ({
    id: 20, active: true, role: "FINANCEIRO", empresaId: null,
  } as any));
  t.mock.method(storage, "getCompany", async (id: number) => ({ id, active: true } as any));
  t.mock.method(storage, "getNfeEmissaoForCompany", async (id: number, companyId: number) =>
    id === 1 && companyId === 10 ? ({ id, orderId: 101 } as any) : undefined);
  t.mock.method(storage, "getOrder", async () => ({ order: { id: 101, companyId: 10 }, items: [] } as any));

  const ownHistory = await request(
    { userId: 20, userRole: "FINANCEIRO" }, "GET", "/api/nfe/1/cce", { "X-Empresa-Id": "10" },
  );
  assert.equal(ownHistory.status, 200);
  assert.equal(ownHistory.fiscalCalls.history, 1);

  const crossHistory = await request(
    { userId: 20, userRole: "FINANCEIRO" }, "GET", "/api/nfe/1/cce", { "X-Empresa-Id": "11" },
  );
  assert.equal(crossHistory.status, 404);
  assert.equal(crossHistory.fiscalCalls.history, 0);

  const crossTransmission = await request(
    { userId: 20, userRole: "FINANCEIRO" }, "POST", "/api/nfe/1/cce", { "X-Empresa-Id": "11" },
  );
  assert.equal(crossTransmission.status, 404);
  assert.equal(crossTransmission.fiscalCalls.transmit, 0);
});
test("CC-e bloqueia perfil sem autorização fiscal antes de consultar ou transmitir", async (t) => {
  t.mock.method(storage, "getUser", async () => ({
    id: 21, active: true, role: "COMERCIAL", empresaId: null,
  } as any));
  t.mock.method(storage, "getCompany", async (id: number) => ({ id, active: true } as any));
  const scopedNfe = t.mock.method(storage, "getNfeEmissaoForCompany", async () => ({ id: 1, orderId: 101 } as any));

  const response = await request(
    { userId: 21, userRole: "COMERCIAL" }, "POST", "/api/nfe/1/cce", { "X-Empresa-Id": "10" },
  );
  assert.equal(response.status, 403);
  assert.equal(response.fiscalCalls.transmit, 0);
  assert.equal(scopedNfe.mock.calls.length, 0);
});

test("CC-e mantém escopo global explícito e bloqueia NF-e sem vínculo ou inexistente", async (t) => {
  t.mock.method(storage, "getUser", async () => ({
    id: 1, active: true, role: "MASTER", empresaId: null,
  } as any));
  t.mock.method(storage, "getNfeEmissao", async (id: number) =>
    id === 1 ? ({ id, orderId: 101 } as any) : id === 2 ? ({ id, orderId: null } as any) : undefined);
  t.mock.method(storage, "getOrder", async () => ({ order: { id: 101, companyId: 10 }, items: [] } as any));
  const response = await request({ userId: 1, userRole: "MASTER" }, "GET", "/api/nfe/1/cce");
  assert.equal(response.status, 200);
  assert.equal(response.fiscalCalls.history, 1);
  const noOrder = await request({ userId: 1, userRole: "MASTER" }, "GET", "/api/nfe/2/cce");
  assert.equal(noOrder.status, 403, "NF-e without a valid order link is denied");
  assert.equal(noOrder.fiscalCalls.history, 0);
  const missing = await request({ userId: 1, userRole: "MASTER" }, "GET", "/api/nfe/3/cce");
  assert.equal(missing.status, 404, "missing NF-e is not exposed");
  assert.equal(missing.fiscalCalls.history, 0);
});

