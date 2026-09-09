import assert from "node:assert/strict";
import test from "node:test";
import { requireAuth, requireRole } from "../../server/core/http/requireAuth";
import { runWithTenant } from "../../server/core/tenant/context";
import { withTenant } from "../../server/core/tenant/scope";
import { UnauthorizedError, ForbiddenError } from "../../server/shared/errors/AppError";
import {
  createAccountReceivableSchema,
  updateAccountPayableSchema,
} from "../../server/modules/finance/finance.validation";
import {
  bankAccountCreateSchema,
  boletoSchema,
} from "../../server/routes/bank.validation";
import {
  reconciliarTransacoes,
  resumoReconciliacao,
} from "../../server/services/financeiro/bankReconciliation";
import { bankAccounts } from "@shared/schema";

function runMiddleware(
  middleware: (req: any, res: any, next: (error?: unknown) => void) => unknown,
  req: any,
) {
  return new Promise<unknown>((resolve) => {
    middleware(req, {}, (error?: unknown) => resolve(error));
  });
}

test("unauthenticated requests receive 401 and an unauthorized role receives 403", async () => {
  const unauthenticated = await runMiddleware(requireAuth, { session: undefined });
  assert.ok(unauthenticated instanceof UnauthorizedError);

  const forbidden = await runMiddleware(
    requireRole(["FINANCEIRO"]),
    { session: { userId: 7, userRole: "OPERATIONS_MANAGER" } },
  );
  assert.ok(forbidden instanceof ForbiddenError);
});

test("the authorized finance role continues through RBAC", async () => {
  const error = await runMiddleware(
    requireRole(["FINANCEIRO"]),
    { session: { userId: 7, userRole: "FINANCEIRO" } },
  );
  assert.equal(error, undefined);
});

test("tenant context wins over tenant fields supplied by the client", () => {
  const result = runWithTenant(
    {
      principal: { kind: "admin", empresaId: 10, userId: 7, role: "FINANCEIRO" },
      empresaId: 10,
    },
    () => ({
      finance: withTenant({ tenantId: 999, companyId: 20 }),
      bank: withTenant(bankAccounts, { empresaId: 999, banco: "itau", nome: "Principal" }),
    }),
  );
  assert.equal(result.finance.tenantId, 10);
  assert.equal(result.bank.empresaId, 10);
});

test("finance HTTP DTOs discard server-controlled financial state", () => {
  const ar = createAccountReceivableSchema.parse({
    descricao: "Título",
    valor: 100,
    dataEmissao: "2026-09-09",
    dataVencimento: "2026-09-30",
    status: "pago",
    pagoEm: "2026-09-09T10:00:00.000Z",
    tenantId: 999,
    pixPayload: "forged",
  });
  assert.equal(ar.status, undefined);
  assert.equal((ar as any).pagoEm, undefined);
  assert.equal((ar as any).tenantId, undefined);
  assert.equal((ar as any).pixPayload, undefined);

  const ap = updateAccountPayableSchema.parse({
    valor: 250,
    status: "pago",
    pagoEm: "2026-09-09T10:00:00.000Z",
    tenantId: 999,
  });
  assert.deepEqual(ap, { valor: "250" });
});

test("bank account input cannot mutate status, balance, tenant or timestamps", () => {
  assert.throws(() =>
    bankAccountCreateSchema.parse({
      banco: "Itaú",
      nome: "Principal",
      status: "conectado",
      saldoAtual: "999999",
      empresaId: 999,
      createdAt: "2026-09-09T10:00:00.000Z",
    }),
  );
});

test("boleto DTO rejects fields outside the bank integration contract", () => {
  assert.throws(() =>
    boletoSchema.parse({
      valor: 10,
      vencimento: "2026-09-30",
      sacadoNome: "Cliente",
      sacadoCnpjCpf: "12345678901",
      sacadoLogradouro: "Rua A",
      sacadoCidade: "São Paulo",
      sacadoUf: "SP",
      sacadoCep: "01000000",
      contaReceivableId: 999,
    }),
  );
});

test("reconciliation matches only pending records supplied to the pure engine", () => {
  const matches = reconciliarTransacoes(
    [{
      id: "tx-1",
      tipo: "credito",
      valor: 100,
      data: "2026-09-09",
      descricao: "PIX",
    }],
    [{
      id: 1,
      descricao: "Recebimento",
      valor: "100.00",
      dataVencimento: "2026-09-09",
      status: "pendente",
    }],
    [],
  );
  assert.equal(matches[0]?.match?.type, "ar");
  assert.equal(matches[0]?.match?.id, 1);
  assert.deepEqual(resumoReconciliacao(matches), {
    total: 1,
    comMatch: 1,
    semMatch: 0,
    totalCredito: 100,
    totalDebito: 0,
    matchAlta: 1,
    matchMedia: 0,
  });
});