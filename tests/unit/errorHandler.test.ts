/**
 * Unit tests for the global error-handling middleware.
 *
 * Locks the response contract for every AppError subclass plus the
 * unknown-error fallback. Uses Node's built-in test runner (`node:test`)
 * and `supertest` is NOT required — we drive the middleware by mounting
 * a tiny Express app and issuing requests through `http`.
 *
 * Run with:
 *   npx tsx --test tests/unit/errorHandler.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { errorHandler } from "../../server/core/errors/errorHandler";
import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  ServiceUnavailableError,
} from "../../server/shared/errors/AppError";

type ErrorBody = {
  success: false;
  error: { message: string; code: string; details?: unknown };
};

/**
 * Boots a throwaway Express server whose `/throw` route simply rethrows the
 * error supplied by the test. Returns the base URL plus a `close()` helper.
 */
function bootServerThatThrows(err: unknown): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.get("/throw", (_req, _res, next) => next(err));
  app.use(errorHandler);

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        throw new Error("Failed to bind ephemeral port");
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((e) => (e ? rej(e) : res())),
          ),
      });
    });
  });
}

/** Performs GET /throw and parses the JSON body + status. */
async function fetchError(
  thrown: unknown,
): Promise<{ status: number; body: ErrorBody }> {
  const { url, close } = await bootServerThatThrows(thrown);
  try {
    const res = await fetch(`${url}/throw`);
    const body = (await res.json()) as ErrorBody;
    return { status: res.status, body };
  } finally {
    await close();
  }
}

/** Asserts the canonical `{ success: false, error: { message, code } }` shape. */
function assertErrorEnvelope(
  body: ErrorBody,
  expected: { message: string; code: string; details?: unknown },
) {
  assert.equal(body.success, false, "envelope.success must be false");
  assert.ok(body.error, "envelope.error must exist");
  assert.equal(typeof body.error.message, "string");
  assert.equal(typeof body.error.code, "string");
  assert.equal(body.error.message, expected.message);
  assert.equal(body.error.code, expected.code);
  if (expected.details !== undefined) {
    assert.deepEqual(body.error.details, expected.details);
  } else {
    assert.equal(
      body.error.details,
      undefined,
      "details must be omitted when not provided",
    );
  }
}

describe("errorHandler — AppError hierarchy", () => {
  test("BadRequestError → 400 with BAD_REQUEST + details", async () => {
    const details = { field: "email", reason: "invalid format" };
    const { status, body } = await fetchError(
      new BadRequestError("Email inválido", details),
    );
    assert.equal(status, 400);
    assertErrorEnvelope(body, {
      message: "Email inválido",
      code: "BAD_REQUEST",
      details,
    });
  });

  test("UnauthorizedError → 401 with UNAUTHORIZED", async () => {
    const { status, body } = await fetchError(
      new UnauthorizedError("Sessão expirada"),
    );
    assert.equal(status, 401);
    assertErrorEnvelope(body, {
      message: "Sessão expirada",
      code: "UNAUTHORIZED",
    });
  });

  test("ForbiddenError → 403 with FORBIDDEN", async () => {
    const { status, body } = await fetchError(
      new ForbiddenError("Sem permissão"),
    );
    assert.equal(status, 403);
    assertErrorEnvelope(body, {
      message: "Sem permissão",
      code: "FORBIDDEN",
    });
  });

  test("NotFoundError → 404 with NOT_FOUND", async () => {
    const { status, body } = await fetchError(
      new NotFoundError("Pedido não encontrado"),
    );
    assert.equal(status, 404);
    assertErrorEnvelope(body, {
      message: "Pedido não encontrado",
      code: "NOT_FOUND",
    });
  });

  test("ConflictError → 409 with CONFLICT + details preserved", async () => {
    const details = { conflictWith: "order#42", requiresConfirmation: true };
    const { status, body } = await fetchError(
      new ConflictError("Pedido fiscal duplicado", details),
    );
    assert.equal(status, 409);
    assertErrorEnvelope(body, {
      message: "Pedido fiscal duplicado",
      code: "CONFLICT",
      details,
    });
  });

  test("ValidationError → 422 with VALIDATION_ERROR + details", async () => {
    const details = [{ path: "qty", message: "must be > 0" }];
    const { status, body } = await fetchError(
      new ValidationError("Dados inválidos", details),
    );
    assert.equal(status, 422);
    assertErrorEnvelope(body, {
      message: "Dados inválidos",
      code: "VALIDATION_ERROR",
      details,
    });
  });

  test("ServiceUnavailableError → 503 with SERVICE_UNAVAILABLE", async () => {
    const { status, body } = await fetchError(
      new ServiceUnavailableError("Em manutenção"),
    );
    assert.equal(status, 503);
    assertErrorEnvelope(body, {
      message: "Em manutenção",
      code: "SERVICE_UNAVAILABLE",
    });
  });

  test("AppError base — custom status/code/details flow through", async () => {
    const details = { tag: "custom" };
    const { status, body } = await fetchError(
      new AppError("falha customizada", 418, "I_AM_A_TEAPOT", details),
    );
    assert.equal(status, 418);
    assertErrorEnvelope(body, {
      message: "falha customizada",
      code: "I_AM_A_TEAPOT",
      details,
    });
  });
});

describe("errorHandler — fallbacks", () => {
  test("Unknown Error → 500 with INTERNAL_ERROR", async () => {
    const { status, body } = await fetchError(new Error("random"));
    assert.equal(status, 500);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.equal(body.error.message, "random");
  });

  test("Unknown Error without message → generic 500 message", async () => {
    const { status, body } = await fetchError(new Error());
    assert.equal(status, 500);
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.equal(body.error.message, "Erro interno do servidor");
  });
});
