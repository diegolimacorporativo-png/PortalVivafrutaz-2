import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_TRANSITIONS,
  LEGACY_STATUS_MAP,
  OrderStatus,
  validateBusinessRules,
} from "../../server/modules/orders/orders.workflow";

const activeCompany = { active: true, isLocked: false, companyName: "Cliente Teste" };

test("Fase 1 — mantém INVOICED e permite o pipeline operacional", () => {
  assert.equal(OrderStatus.INVOICED, "INVOICED");
  assert.deepEqual(ALLOWED_TRANSITIONS[OrderStatus.READY], [
    OrderStatus.INVOICED,
    OrderStatus.CANCELLED,
  ]);
  assert.deepEqual(ALLOWED_TRANSITIONS[OrderStatus.INVOICED], [
    OrderStatus.SHIPPED,
    OrderStatus.CANCELLED,
  ]);
  assert.equal(LEGACY_STATUS_MAP[OrderStatus.INVOICED], "CONFIRMED");
});

test("Fase 1 — SHIPPED não exige NF, pré-nota ou status fiscal", () => {
  assert.doesNotThrow(() =>
    validateBusinessRules({
      orderId: 1,
      to: OrderStatus.SHIPPED,
      company: activeCompany,
      orderRow: {
        fiscalStatus: "nota_pendente",
        preNotaNumber: null,
        erpExportStatus: "nao_exportado",
        erpId: null,
      },
      arByCompany: [],
    }),
  );
});

test("Fase 1 — aprovação continua bloqueando empresa inválida", () => {
  assert.throws(
    () =>
      validateBusinessRules({
        orderId: 1,
        to: OrderStatus.APPROVED,
        company: { ...activeCompany, isLocked: true },
        orderRow: {},
        arByCompany: [],
      }),
    /bloqueada/,
  );
});

test("Fase 1 — aprovação continua bloqueando cobrança vencida", () => {
  assert.throws(
    () =>
      validateBusinessRules({
        orderId: 1,
        to: OrderStatus.APPROVED,
        company: activeCompany,
        orderRow: {},
        arByCompany: [{ status: "vencido" }],
      }),
    /cobranças vencidas/,
  );
});