import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { describe, test } from "node:test";
import {
  canManageGlobalPush,
  register,
  type PushRouteDependencies,
} from "../../server/routes/push.routes";

type Actor = {
  id: number;
  role: string;
  empresaId: number | null;
};

const validSubscription = {
  endpoint: "https://push.example.test/subscription-1",
  keys: { p256dh: "p256dh-value", auth: "auth-value" },
};

async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function makeApp(
  actor: Actor | null,
  options: {
    ownedEndpoint?: string;
    fireCalls?: unknown[];
    upsertCalls?: unknown[];
    settingCalls?: unknown[];
    deactivateCalls?: unknown[];
  } = {},
) {
  const fireCalls = options.fireCalls ?? [];
  const upsertCalls = options.upsertCalls ?? [];
  const settingCalls = options.settingCalls ?? [];
  const deactivateCalls = options.deactivateCalls ?? [];

  const dependencies: PushRouteDependencies = {
    storage: {
      getUser: async (id) => actor && actor.id === id ? actor as any : undefined,
      upsertPushSubscriptionOwned: async (data) => {
        upsertCalls.push(data);
        if (options.ownedEndpoint && data.endpoint !== options.ownedEndpoint) return null;
        return { id: 1, ...data, createdAt: new Date() } as any;
      },
      deactivatePushSubscriptionOwned: async (endpoint, owner) => {
        deactivateCalls.push({ endpoint, owner });
        return !options.ownedEndpoint || endpoint === options.ownedEndpoint;
      },
      getNotificationSettings: async () => [{
        id: 1,
        event: "clara_alert",
        enabled: true,
        title: "Alerta",
        body: "{message}",
        targetAudience: "staff",
        updatedAt: new Date(),
      }] as any,
      getPushSubscriptionCount: async () => 2,
      upsertNotificationSetting: async (event, data) => {
        settingCalls.push([event, data]);
        return {
          id: 1,
          event,
          ...data,
          title: "Alerta",
          body: "{message}",
          targetAudience: "staff",
          updatedAt: new Date(),
        } as any;
      },
    },
    fireNotification: async (...args) => {
      fireCalls.push(args);
    },
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = actor
      ? { userId: actor.id, userRole: actor.role }
      : {};
    next();
  });
  void register(app, dependencies);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error?.status ?? 500).json({ message: error?.message ?? "error" });
  });

  return { app, fireCalls, upsertCalls, deactivateCalls };
}

describe("Etapa 23 — segurança das rotas de Push", () => {
  test("a chave VAPID exposta contém somente o campo público", async () => {
    const { app } = makeApp(null);
    const response = await request(app, "GET", "/api/push/vapid-public-key");
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.body).sort(), ["publicKey"]);
    assert.equal("privateKey" in response.body, false);
  });

  test("exige sessão nas subscriptions e na administração", async () => {
    const { app } = makeApp(null);
    for (const [method, path, body] of [
      ["POST", "/api/push/subscribe", validSubscription],
      ["POST", "/api/push/unsubscribe", { endpoint: validSubscription.endpoint }],
      ["GET", "/api/push/settings", undefined],
      ["PATCH", "/api/push/settings/clara_alert", { enabled: true }],
      ["POST", "/api/push/test", {}],
    ] as const) {
      const response = await request(app, method, path, body);
      assert.equal(response.status, 401, `${method} ${path} deve exigir sessão`);
    }
  });

  test("deriva empresa e usuário da sessão e rejeita spoofing no body", async () => {
    const actor: Actor = { id: 7, role: "DRIVER", empresaId: 10 };
    const capture: unknown[] = [];
    const { app, upsertCalls } = makeApp(actor, { upsertCalls: capture });

    const spoofed = await request(app, "POST", "/api/push/subscribe", {
      ...validSubscription,
      userId: 99,
      companyId: 20,
      empresaId: 20,
      tenantId: 20,
    });
    assert.equal(spoofed.status, 400);
    assert.equal(upsertCalls.length, 0);

    const accepted = await request(app, "POST", "/api/push/subscribe", validSubscription);
    assert.equal(accepted.status, 200);
    assert.deepEqual(upsertCalls[0], {
      endpoint: validSubscription.endpoint,
      p256dh: "p256dh-value",
      auth: "auth-value",
      userAgent: "node",
      userId: 7,
      companyId: 10,
      active: true,
    });
  });

  test("não permite remover subscription de outro usuário e permite a própria", async () => {
    const actor: Actor = { id: 7, role: "CLIENT", empresaId: 10 };
    const { app, deactivateCalls } = makeApp(actor, {
      ownedEndpoint: "https://push.example.test/owned-by-someone-else",
    });

    const blocked = await request(app, "POST", "/api/push/unsubscribe", {
      endpoint: validSubscription.endpoint,
    });
    assert.equal(blocked.status, 403);
    assert.deepEqual(deactivateCalls[0], {
      endpoint: validSubscription.endpoint,
      owner: { userId: 7, companyId: 10 },
    });

    const own = await request(app, "POST", "/api/push/unsubscribe", {
      endpoint: "https://push.example.test/owned-by-someone-else",
    });
    assert.equal(own.status, 200);
  });

  test("somente administradores globais sem empresa consultam a configuração", async () => {
    for (const role of ["MASTER", "DIRECTOR", "ADMIN", "DEVELOPER"]) {
      const { app } = makeApp({ id: 1, role, empresaId: null });
      const response = await request(app, "GET", "/api/push/settings");
      assert.equal(response.status, 200, `${role} global deve ser permitido`);
    }

    for (const actor of [
      { id: 2, role: "ADMIN", empresaId: 10 },
      { id: 3, role: "DEVELOPER", empresaId: 20 },
      { id: 4, role: "DIRECTOR", empresaId: 30 },
      { id: 5, role: "CLIENT", empresaId: 10 },
      { id: 6, role: "MOTORISTA", empresaId: 10 },
    ] satisfies Actor[]) {
      const { app } = makeApp(actor);
      const response = await request(app, "GET", "/api/push/settings");
      assert.equal(response.status, 403, `${actor.role} não deve acessar configuração global`);
    }
  });

  test("PATCH aceita somente enabled e somente eventos conhecidos", async () => {
    const settingCalls: unknown[] = [];
    const { app } = makeApp(
      { id: 1, role: "MASTER", empresaId: null },
      { settingCalls },
    );

    const massAssignment = await request(app, "PATCH", "/api/push/settings/clara_alert", {
      enabled: true,
      title: "conteúdo alterado",
      body: "payload alterado",
      targetAudience: "all",
      companyId: 20,
      secret: "não pode",
    });
    assert.equal(massAssignment.status, 400);
    assert.equal(settingCalls.length, 0);

    const unknownEvent = await request(app, "PATCH", "/api/push/settings/not-configured", {
      enabled: true,
    });
    assert.equal(unknownEvent.status, 400);
    assert.equal(settingCalls.length, 0);

    const accepted = await request(app, "PATCH", "/api/push/settings/clara_alert", {
      enabled: false,
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(settingCalls, [["clara_alert", { enabled: false }]]);
  });

  test("o teste usa payload fixo, bloqueia destinatários arbitrários e não envia durante o teste", async () => {
    const fireCalls: unknown[] = [];
    const { app } = makeApp(
      { id: 1, role: "DIRECTOR", empresaId: null },
      { fireCalls },
    );

    const spoofed = await request(app, "POST", "/api/push/test", {
      recipientUserId: 99,
      companyId: 20,
      tenantId: 20,
      payload: { body: "arbitrário" },
    });
    assert.equal(spoofed.status, 400);
    assert.equal(fireCalls.length, 0);

    const accepted = await request(app, "POST", "/api/push/test", {});
    assert.equal(accepted.status, 200);
    assert.equal(fireCalls.length, 1);
    assert.deepEqual(fireCalls[0], [
      "clara_alert",
      { message: "✅ Notificações push funcionando corretamente no VivaFrutaz!" },
      { url: "/admin" },
    ]);
  });

  test("a política global rejeita explicitamente administrador vinculado a tenant", () => {
    assert.equal(canManageGlobalPush({ role: "MASTER", empresaId: null }), true);
    assert.equal(canManageGlobalPush({ role: "DIRECTOR", empresaId: null }), true);
    assert.equal(canManageGlobalPush({ role: "ADMIN", empresaId: 10 }), false);
    assert.equal(canManageGlobalPush({ role: "DEVELOPER", empresaId: 10 }), false);
  });
});