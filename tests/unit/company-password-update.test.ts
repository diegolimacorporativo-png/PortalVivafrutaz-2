import assert from "node:assert/strict";
import { mock, test } from "node:test";
import bcrypt from "bcryptjs";
import { db } from "../../server/database/db";
import { CompaniesRepository } from "../../server/modules/companies/companies.repository";
import { CompaniesController } from "../../server/modules/companies/companies.controller";
import { updateCompanySchema } from "../../server/modules/companies/companies.validation";

test("company update validation preserves a new password for the internal handler", () => {
  const parsed = updateCompanySchema.parse({ password: "NovaSenhaSegura123" });
  assert.equal(parsed.password, "NovaSenhaSegura123");
});

test("company update validation rejects passwords shorter than eight characters", () => {
  assert.equal(updateCompanySchema.safeParse({ password: "curta" }).success, false);
});

test("company persistence hashes the new password accepted by company login", async (t) => {
  let persisted: Record<string, unknown> | undefined;
  const update = mock.method(db, "update", () => ({
    set(values: Record<string, unknown>) {
      persisted = values;
      return {
        where() {
          return { returning: async () => [{ id: 42, ...values }] };
        },
      };
    },
  }) as any);
  t.after(() => update.mock.restore());

  const plainPassword = "NovaSenhaSegura123";
  await new CompaniesRepository().updateCompany(42, { password: plainPassword } as any);

  assert.equal(typeof persisted?.password, "string");
  assert.notEqual(persisted?.password, plainPassword);
  assert.equal(await bcrypt.compare(plainPassword, persisted!.password as string), true);
});

test("internal company update persists password-change flags and never returns the hash", async () => {
  let received: Record<string, unknown> | undefined;
  const controller = new CompaniesController({
    update: async (_id: number, updates: Record<string, unknown>) => {
      received = updates;
      return {
        id: 42,
        companyName: "Empresa teste",
        ...updates,
        password: "bcrypt-hash-must-not-leave-the-server",
      } as any;
    },
  } as any);
  let body: any;
  const req = {
    params: { id: "42" },
    body: { password: "NovaSenhaSegura123" },
    session: { userId: 9, companyId: null },
  } as any;
  const res = {
    status() { return this; },
    json(value: unknown) { body = value; return this; },
  } as any;

  await controller.update(req, res);

  assert.equal(received?.password, "NovaSenhaSegura123");
  assert.equal(received?.mustChangePassword, false);
  assert.equal(received?.passwordTemporary, false);
  assert.ok(received?.passwordChangedAt instanceof Date);
  assert.equal(received?.loginAttempts, 0);
  assert.equal(received?.isLocked, false);
  assert.equal(JSON.stringify(body.data).includes("bcrypt-hash-must-not-leave-the-server"), false);
});
