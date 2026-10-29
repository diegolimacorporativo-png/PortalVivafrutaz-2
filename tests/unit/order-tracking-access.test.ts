import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runWithTenant } from "../../server/core/tenant/context";
import { ForbiddenError, UnauthorizedError } from "../../server/shared/errors/AppError";
import {
  classifyOrderTrackingSession,
  resolveOrderTrackingCompanyId,
} from "../../server/modules/orders/tracking-access";

function resolveCompany(session: Parameters<typeof classifyOrderTrackingSession>[0], tenantId: number | null) {
  return runWithTenant(
    {
      principal: { kind: "company", empresaId: tenantId ?? 1 },
      empresaId: tenantId,
    },
    () => resolveOrderTrackingCompanyId(classifyOrderTrackingSession(session), tenantId),
  );
}

describe("authenticated order tracking access", () => {
  test("company session can only resolve its server-established tenant", () => {
    assert.equal(resolveCompany({ userType: "company", companyId: 31 }, 31), 31);
    assert.throws(
      () => resolveCompany({ userType: "company", companyId: 31 }, 32),
      ForbiddenError,
    );
  });

  test("does not accept a company session without a valid company identity", () => {
    assert.throws(() => resolveCompany({ userType: "company" }, 31), UnauthorizedError);
    assert.throws(() => resolveCompany({ userType: "company", companyId: 0 }, 31), UnauthorizedError);
  });

  test("rejects missing sessions and preserves the legacy CLIENT session contract", () => {
    assert.throws(() => resolveCompany(undefined, 31), UnauthorizedError);
    assert.throws(() => resolveCompany({ userId: 9, userRole: "DIRECTOR" }, 31), ForbiddenError);
    assert.equal(resolveCompany({ userId: 9, userRole: "CLIENT" }, 31), 31);
  });

  test("company scope comes from the session, not caller-supplied request fields", () => {
    const session = { userType: "company", companyId: 31 };
    const request = { query: { empresaId: 32 }, headers: { "x-empresa-id": "32" }, body: { companyId: 32 } };
    assert.equal(resolveCompany(session, 31), 31);
    assert.notEqual(resolveCompany(session, 31), Number(request.query.empresaId));
    assert.notEqual(resolveCompany(session, 31), Number(request.headers["x-empresa-id"]));
    assert.notEqual(resolveCompany(session, 31), request.body.companyId);
  });
});
