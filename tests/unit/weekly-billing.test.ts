import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateWeeklyBillingTotal,
  minimumWeeklyBillingMessage,
} from "../../server/modules/orders/weekly-billing";

const COMPANY_ID = 10;
const OTHER_COMPANY_ID = 99;
const WEEK = "2026-W34";
const MINIMUM = 100;

function allowed(input: Parameters<typeof calculateWeeklyBillingTotal>[0]): boolean {
  return calculateWeeklyBillingTotal(input) >= MINIMUM;
}

describe("valor mínimo semanal — pedido novo", () => {
  test("pedido novo abaixo do mínimo é bloqueado", () => {
    assert.equal(
      allowed({
        companyId: COMPANY_ID,
        weekReference: WEEK,
        existingOrders: [],
        candidateItems: [{ unitPrice: 50, quantity: 1 }],
      }),
      false,
    );
  });

  test("pedido novo acima do mínimo é permitido", () => {
    assert.equal(
      allowed({
        companyId: COMPANY_ID,
        weekReference: WEEK,
        existingOrders: [],
        candidateItems: [{ unitPrice: 100, quantity: 1 }],
      }),
      true,
    );
  });
});

describe("valor mínimo semanal — pedido reaberto", () => {
  test("pedido reaberto que continua acima do mínimo é permitido", () => {
    assert.equal(
      allowed({
        companyId: COMPANY_ID,
        weekReference: WEEK,
        replacingOrderId: 1,
        existingOrders: [{ id: 1, companyId: COMPANY_ID, weekReference: WEEK, status: "OPEN_FOR_EDITING", totalValue: 120 }],
        candidateItems: [{ unitPrice: 120, quantity: 1 }],
      }),
      true,
    );
  });

  test("pedido reaberto que cai abaixo do mínimo é bloqueado", () => {
    assert.equal(
      allowed({
        companyId: COMPANY_ID,
        weekReference: WEEK,
        replacingOrderId: 1,
        existingOrders: [{ id: 1, companyId: COMPANY_ID, weekReference: WEEK, status: "OPEN_FOR_EDITING", totalValue: 120 }],
        candidateItems: [{ unitPrice: 80, quantity: 1 }],
      }),
      false,
    );
  });

  test("reduzir quantidades de um pedido antes acima do mínimo bloqueia quando o total semanal fica abaixo", () => {
    assert.equal(
      allowed({
        companyId: COMPANY_ID,
        weekReference: WEEK,
        replacingOrderId: 1,
        existingOrders: [
          { id: 1, companyId: COMPANY_ID, weekReference: WEEK, status: "OPEN_FOR_EDITING", totalValue: 130 },
          { id: 2, companyId: COMPANY_ID, weekReference: WEEK, status: "CONFIRMED", totalValue: 30 },
        ],
        candidateItems: [{ unitPrice: 60, quantity: 1 }],
      }),
      false,
    );
  });

  test("pedido reaberto abaixo do mínimo passa a ser permitido ao atingir o mínimo", () => {
    assert.equal(
      allowed({
        companyId: COMPANY_ID,
        weekReference: WEEK,
        replacingOrderId: 1,
        existingOrders: [
          { id: 1, companyId: COMPANY_ID, weekReference: WEEK, status: "OPEN_FOR_EDITING", totalValue: 70 },
          { id: 2, companyId: COMPANY_ID, weekReference: WEEK, status: "CONFIRMED", totalValue: 30 },
        ],
        candidateItems: [{ unitPrice: 70, quantity: 1 }],
      }),
      true,
    );
  });
});

describe("valor mínimo semanal — isolamento de tenant", () => {
  test("ignora pedidos de outro tenant no total", () => {
    const total = calculateWeeklyBillingTotal({
      companyId: COMPANY_ID,
      weekReference: WEEK,
      existingOrders: [
        { id: 1, companyId: OTHER_COMPANY_ID, weekReference: WEEK, status: "CONFIRMED", totalValue: 1000 },
      ],
      candidateItems: [{ unitPrice: 50, quantity: 1 }],
    });

    assert.equal(total, 50);
    assert.equal(
      minimumWeeklyBillingMessage(MINIMUM, total),
      "A programação da semana não atingiu o faturamento mínimo de R$ 100,00. Total calculado: R$ 50,00.",
    );
  });
});