import assert from "node:assert/strict";
import test, { describe, mock } from "node:test";
import { requireAuth, requireRole } from "../../server/core/http/requireAuth";
import { ForbiddenError, UnauthorizedError } from "../../server/shared/errors/AppError";
import { storage } from "../../server/services/storage";

type Middleware = (
  req: any,
  res: any,
  next: (error?: unknown) => void,
) => unknown;

function runMiddleware(middleware: Middleware, req: any): Promise<unknown> {
  return new Promise((resolve) => {
    middleware(req, {}, (error?: unknown) => resolve(error));
  });
}

async function runChain(middlewares: Middleware[], req: any): Promise<unknown> {
  let error: unknown;
  for (const middleware of middlewares) {
    error = await runMiddleware(middleware, req);
    if (error) return error;
  }
  return undefined;
}

describe("RBAC strict mode", () => {
  test("MASTER-only policy allows MASTER and rejects every other known role", async () => {
    const knownRoles = [
      "MASTER",
      "DIRECTOR",
      "ADMIN",
      "DEVELOPER",
      "OPERATIONS_MANAGER",
      "LOGISTICS",
      "PURCHASE_MANAGER",
      "FINANCEIRO",
      "FINANCE",
      "DRIVER",
      "MOTORISTA",
      "CLIENT",
      "SERVICE",
    ];

    for (const role of knownRoles) {
      const lookup = mock.method(storage, "getUser", async () => ({ id: 7, role, empresaId: null } as any));
      let error: unknown;
      try {
        error = await runChain(
          [requireAuth, requireRole(["MASTER"], { strict: true })],
          { session: { userId: 7, userRole: role } },
        );
      } finally { lookup.mock.restore(); }

      if (role === "MASTER") {
        assert.equal(error, undefined, `role ${role} deve passar`);
      } else {
        assert.ok(error instanceof ForbiddenError, `role ${role} deve receber 403`);
      }
    }
  });

  test("unauthenticated access is rejected before the strict role check", async () => {
    const error = await runChain(
      [requireAuth, requireRole(["MASTER"], { strict: true })],
      { session: undefined },
    );

    assert.ok(error instanceof UnauthorizedError);
  });

  test("strict mode preserves explicitly allowed global roles for legacy company-bound accounts", async () => {
    for (const role of ["MASTER", "DIRECTOR", "DEVELOPER"]) {
      const lookup = mock.method(storage, "getUser", async () => ({ id: 7, role, empresaId: 10 } as any));
      try {
        const error = await runMiddleware(
          requireRole(["MASTER", "DIRECTOR", "DEVELOPER"], { strict: true }),
          { session: { userId: 7, userRole: role } },
        );
        assert.equal(error, undefined, `role ${role} deve continuar autorizada`);
      } finally { lookup.mock.restore(); }
    }
  });

  test("non-strict mode remains available for intentionally broad operational policies", async () => {
    for (const role of ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"]) {
      const error = await runMiddleware(
        requireRole(["LOGISTICS"]),
        { session: { userId: 7, userRole: role } },
      );
      assert.equal(error, undefined, `bypass estratégico legado de ${role} não deve mudar`);
    }

    const strictError = await runMiddleware(
      requireRole(["LOGISTICS"], { strict: true }),
      { session: { userId: 7, userRole: "ADMIN" } },
    );
    assert.ok(strictError instanceof ForbiddenError);
  });

  test("request tenant fields cannot spoof a role-only MASTER policy", async () => {
    const error = await runMiddleware(
      requireRole(["MASTER"], { strict: true }),
      {
        session: { userId: 7, userRole: "ADMIN" },
        body: { empresaId: 1, tenantId: 1, role: "MASTER" },
        query: { empresaId: "1", tenantId: "1" },
      },
    );

    assert.ok(error instanceof ForbiddenError);
  });
});
