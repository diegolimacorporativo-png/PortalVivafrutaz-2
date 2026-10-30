import assert from "node:assert/strict";
import { mock, test } from "node:test";
import bcrypt from "bcryptjs";
import { db } from "../../server/database/db";
import { CompaniesRepository } from "../../server/modules/companies/companies.repository";
import { CompaniesController } from "../../server/modules/companies/companies.controller";
import { createCompanySchema, updateCompanySchema } from "../../server/modules/companies/companies.validation";
import { runWithTenant } from "../../server/core/tenant/context";

test("company creation requires a password chosen in the form", () => {
  const company = {
    companyName: "Empresa sintética",
    contactName: "Pessoa de teste",
    email: "empresa-sintetica@example.test",
    allowedOrderDays: [],
  };
  assert.equal(createCompanySchema.safeParse(company).success, false);
  assert.equal(createCompanySchema.safeParse({ ...company, password: "curta" }).success, false);
  assert.equal(createCompanySchema.safeParse({ ...company, password: "SenhaEscolhida123" }).success, true);
});

test("company creation persists the chosen password without returning a hash or generated password", async () => {
  let received: Record<string, unknown> | undefined;
  const controller = new CompaniesController({
    create: async (input: Record<string, unknown>) => {
      received = input;
      return { id: 77, companyName: "Empresa sintética", password: "bcrypt-hash" } as any;
    },
  } as any);
  let body: any;
  const req = { body: { companyName: "Empresa sintética", password: "SenhaEscolhida123" }, session: { userId: 9 } } as any;
  const res = { status() { return this; }, json(value: unknown) { body = value; return this; } } as any;

  await runWithTenant(
    { principal: { kind: "admin", empresaId: null, userId: 9, role: "DIRECTOR" }, empresaId: null },
    () => controller.create(req, res),
  );

  assert.equal(received?.password, "SenhaEscolhida123");
  assert.equal(received?.mustChangePassword, false);
  assert.equal(received?.passwordTemporary, false);
  assert.ok(received?.passwordChangedAt instanceof Date);
  assert.equal(body.password, undefined);
  assert.equal(body.temporaryPassword, undefined);
});

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

  await runWithTenant(
    { principal: { kind: "admin", empresaId: 42, userId: 9, role: "DIRECTOR" }, empresaId: 42 },
    () => controller.update(req, res),
  );

  assert.equal(received?.password, "NovaSenhaSegura123");
  assert.equal(received?.mustChangePassword, false);
  assert.equal(received?.passwordTemporary, false);
  assert.ok(received?.passwordChangedAt instanceof Date);
  assert.equal(received?.loginAttempts, 0);
  assert.equal(received?.isLocked, false);
  assert.equal(JSON.stringify(body.data).includes("bcrypt-hash-must-not-leave-the-server"), false);
});

test("company portal principal cannot change the company's password", async () => {
  const controller = new CompaniesController({
    update: async () => { throw new Error("service must not be called"); },
  } as any);
  const req = { params: { id: "42" }, body: { password: "NovaSenhaSegura123" }, session: { companyId: 42 } } as any;
  const res = { status() { return this; }, json() { return this; } } as any;

  await assert.rejects(
    () => runWithTenant(
      { principal: { kind: "company", empresaId: 42 }, empresaId: 42 },
      () => controller.update(req, res),
    ),
    /equipe interna/i,
  );
});
