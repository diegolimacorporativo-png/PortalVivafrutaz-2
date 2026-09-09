/**
 * Reports tenant-isolation tests.
 *
 * The tests exercise the tenant-resolution boundary with mocked user lookups.
 * No report query or database mutation is performed.
 */
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCompanyId,
  reportsTenantContext,
} from "../../server/routes/reports.routes";
import { runWithTenant } from "../../server/core/tenant/context";
import { storage } from "../../server/services/storage";
import { ForbiddenError, UnauthorizedError } from "../../server/shared/errors/AppError";
import { requireAuth, requireRole } from "../../server/core/http/requireAuth";

function withRequestContext<T>(
  empresaId: number | null,
  role: string,
  fn: () => Promise<T> | T,
) {
  return runWithTenant(
    {
      principal: { kind: "admin", empresaId, userId: 1, role },
      empresaId,
    },
    fn,
  );
}

describe("reports — isolamento multiempresa", () => {
  test("tenant A ignora ?companyId=B", async () => {
    await withRequestContext(10, "ADMIN", async () => {
      assert.equal(
        resolveCompanyId({ query: { companyId: "20" }, body: { companyId: 20 } }),
        10,
      );
    });
  });

  test("tenant B nunca resolve o tenant A a partir do request", async () => {
    await withRequestContext(20, "ADMIN", async () => {
      assert.equal(resolveCompanyId({ query: { companyId: "10" } }), 20);
    });
  });

  test("usuário global autorizado pode selecionar empresa explicitamente", async () => {
    await withRequestContext(null, "MASTER", async () => {
      assert.equal(
        resolveCompanyId({ query: { companyId: "20" } }),
        20,
      );
    });
  });

  test("usuário global autorizado sem filtro mantém a visão global", async () => {
    await withRequestContext(null, "DIRECTOR", async () => {
      assert.equal(resolveCompanyId({ query: {} }), undefined);
    });
  });

  test("perfil ADMIN sem empresa não é transformado em acesso global", async () => {
    const original = storage.getUser;
    const getUser = mock.method(storage, "getUser", async () => ({
      id: 1,
      empresaId: null,
      role: "ADMIN",
    } as any));
    try {
      const req = { session: { userId: 1 }, query: { companyId: "20" } };
      const next = mock.fn();
      await reportsTenantContext(req, {}, next);
      assert.equal(next.mock.calls.length, 1);
      assert.ok(next.mock.calls[0].arguments[0] instanceof ForbiddenError);
    } finally {
      getUser.mock.restore();
      (storage as any).getUser = original;
    }
  });

  test("sessão inválida é rejeitada antes de resolver empresa", async () => {
    const getUser = mock.method(storage, "getUser", async () => undefined);
    try {
      const req = { session: { userId: 999 }, query: {} };
      const next = mock.fn();
      await reportsTenantContext(req, {}, next);
      assert.equal(next.mock.calls.length, 1);
      assert.ok(next.mock.calls[0].arguments[0] instanceof UnauthorizedError);
    } finally {
      getUser.mock.restore();
    }
  });

  test("sem autenticação → 401", () => {
    let received: unknown;
    requireAuth(
      { session: {} } as any,
      {} as any,
      (error?: unknown) => { received = error; },
    );
    assert.ok(received instanceof UnauthorizedError);
  });

  test("role não autorizado → 403", async () => {
    let received: unknown;
    await requireRole(["MASTER"], { strict: true })(
      { session: { userRole: "ADMIN" } } as any,
      {} as any,
      (error?: unknown) => { received = error; },
    );
    assert.ok(received instanceof ForbiddenError);
  });
});