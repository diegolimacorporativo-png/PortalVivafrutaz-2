import assert from "node:assert/strict";
import { test } from "node:test";
import { authController } from "../../server/modules/auth/auth.controller";

test("conta de empresa não pode usar a troca voluntária de senha de usuário interno", async () => {
  let statusCode = 0;
  let responseBody: unknown;
  const req = {
    session: { userId: 17, companyId: 23, userType: "company" },
  } as any;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
    },
  } as any;

  await authController.changePasswordSelf(req, res);

  assert.equal(statusCode, 403);
  assert.match(String((responseBody as any)?.message), /apenas para usuários do sistema/i);
});
