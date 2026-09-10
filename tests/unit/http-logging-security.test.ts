import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { afterEach, mock, test } from "node:test";
import { errorHandler } from "../../server/core/errors/errorHandler";
import { logSecurityEvent } from "../../server/core/audit/audit-logger";
import { register as registerHealth } from "../../server/routes/health.routes";
import { requestContextMiddleware } from "../../server/middleware/requestContext";
import { requestIdMiddleware } from "../../server/middleware/requestId";
import { requestLogger } from "../../server/middleware/requestLogger";
import { responseLogger } from "../../server/middleware/responseLogger";
import { storage } from "../../server/services/storage";

type RunningServer = {
  url: string;
  close: () => Promise<void>;
};

async function start(app: express.Express): Promise<RunningServer> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function captureConsole<T>(work: (lines: string[]) => Promise<T>): Promise<T> {
  const lines: string[] = [];
  const methods = ["log", "info", "warn", "error"] as const;
  const mocks = methods.map((method) =>
    mock.method(console, method, (...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "));
    }),
  );
  try {
    return await work(lines);
  } finally {
    for (const consoleMock of mocks) consoleMock.mock.restore();
  }
}

async function fetchJson(
  app: express.Express,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const server = await start(app);
  try {
    const response = await fetch(`${server.url}${path}`, init);
    return { status: response.status, body: await response.json() };
  } finally {
    await server.close();
  }
}

function makeSyntheticApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(requestContextMiddleware);
  app.use(responseLogger);
  return app;
}

const sensitiveValues = [
  "TEST_SECRET_TOKEN",
  "TEST_PASSWORD",
  "TEST_API_KEY",
  "TEST_SESSION_ID",
  "TEST_CERTIFICATE",
  "TEST_CPF",
  "TEST_BANK_ACCOUNT",
];

afterEach(() => {
  mock.restoreAll();
});

test("normal API response logs metadata but never the complete response body", async () => {
  const app = makeSyntheticApp();
  app.get("/api/synthetic", (_req, res) => {
    res.json({
      status: "ok",
      token: "TEST_SECRET_TOKEN",
      password: "TEST_PASSWORD",
      apiKey: "TEST_API_KEY",
      sessionId: "TEST_SESSION_ID",
      certificate: "TEST_CERTIFICATE",
      cpf: "TEST_CPF",
      bankAccount: "TEST_BANK_ACCOUNT",
    });
  });

  await captureConsole(async (lines) => {
    const response = await fetchJson(app, "/api/synthetic?token=TEST_SECRET_TOKEN", {
      headers: {
        Authorization: "Bearer TEST_API_KEY",
        Cookie: "session=TEST_SESSION_ID",
      },
    });
    assert.equal(response.status, 200);

    const output = lines.join("\n");
    assert.match(output, /GET \/api\/synthetic 200 in \d+ms/);
    assert.ok(!output.includes("::"), "response logger must not append a serialized body");
    for (const value of sensitiveValues) {
      assert.equal(output.includes(value), false, `${value} leaked into logs`);
    }
  });
});

test("response headers and request credentials are not copied into response logs", async () => {
  const app = makeSyntheticApp();
  app.get("/api/headers", (_req, res) => {
    res.setHeader("Set-Cookie", "session=TEST_SESSION_ID; HttpOnly");
    res.json({ ok: true });
  });

  await captureConsole(async (lines) => {
    const response = await fetchJson(app, "/api/headers", {
      headers: {
        Authorization: "Bearer TEST_API_KEY",
        Cookie: "session=TEST_SESSION_ID",
      },
    });
    assert.equal(response.status, 200);
    const output = lines.join("\n");
    assert.equal(output.includes("TEST_SESSION_ID"), false);
    assert.equal(output.includes("TEST_API_KEY"), false);
    assert.match(output, /GET \/api\/headers 200 in \d+ms/);
  });
});

test("request logger excludes query strings that can carry tokens", async () => {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(requestLogger);
  app.get("/api/reset-password", (_req, res) => res.json({ ok: true }));

  await captureConsole(async (lines) => {
    const response = await fetchJson(app, "/api/reset-password?token=TEST_SECRET_TOKEN");
    assert.equal(response.status, 200);
    const output = lines.join("\n");
    assert.match(output, /GET \/api\/reset-password/);
    assert.equal(output.includes("TEST_SECRET_TOKEN"), false);
    assert.equal(output.includes("?token="), false);
  });
});

test("errors remain logged as safe metadata and return no sensitive message", async () => {
  const app = makeSyntheticApp();
  app.get("/api/failure", (_req, _res, next) => {
    next(new Error("TEST_SECRET_TOKEN TEST_PASSWORD TEST_API_KEY"));
  });
  app.use(errorHandler);

  await captureConsole(async (lines) => {
    const response = await fetchJson(app, "/api/failure");
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      success: false,
      error: { message: "Erro interno do servidor", code: "INTERNAL_ERROR" },
    });
    const output = lines.join("\n");
    assert.match(output, /unhandled error/);
    assert.equal(output.includes("TEST_SECRET_TOKEN"), false);
    assert.equal(output.includes("TEST_PASSWORD"), false);
    assert.equal(output.includes("TEST_API_KEY"), false);
  });
});

test("audit logging continues to persist structured events without response-body coupling", async () => {
  let captured: Record<string, unknown> | undefined;
  const storageLogMock = mock.method(storage, "createLog", async (entry: Record<string, unknown>) => {
    captured = entry;
    return { id: 1 };
  });

  try {
    logSecurityEvent({
      userId: 10,
      companyId: 20,
      role: "ADMIN",
      action: "HTTP_LOG_TEST",
      resource: "/api/synthetic",
      tenantScope: "SINGLE",
      intent: "AUDIT_SYSTEM",
      allowed: true,
      metadata: { safeField: "safe-value" },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(storageLogMock.mock.callCount(), 1);
    assert.equal((captured as any)?.action, "SEC:HTTP_LOG_TEST");
  } finally {
    storageLogMock.mock.restore();
  }
});

test("real health API route remains observable without logging its response body", async () => {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(requestContextMiddleware);
  app.use(responseLogger);
  await registerHealth(app);

  await captureConsole(async (lines) => {
    const response = await fetchJson(app, "/api/health?token=TEST_SECRET_TOKEN");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: "ok" });
    const output = lines.join("\n");
    assert.match(output, /GET \/api\/health 200 in \d+ms/);
    assert.equal(output.includes('{"status":"ok"}'), false);
    assert.equal(output.includes("TEST_SECRET_TOKEN"), false);
  });
});