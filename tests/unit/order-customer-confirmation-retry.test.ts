import assert from "node:assert/strict";
import test from "node:test";
import { retryCustomerConfirmations } from "../../server/modules/orders/customer-confirmation-retry";
import { OrderStatus } from "../../server/modules/orders/orders.workflow";

const activeCompany = { id: 7, companyName: "Empresa sintética", active: true, isLocked: false };
const pendingOrder = {
  id: 41,
  companyId: activeCompany.id,
  workflowStatus: OrderStatus.CUSTOMER_CONFIRMED,
  status: "ACTIVE",
  orderCode: "SYNTHETIC-41",
  deliveryDate: new Date("2026-10-30T12:00:00Z"),
};

test("retry releases only persisted customer-confirmed orders through the workflow transaction", async () => {
  const calls: any[] = [];
  const result = await retryCustomerConfirmations({
    list: async () => [pendingOrder],
    getCompany: async () => activeCompany,
    release: async (order: any, company: any) => {
      calls.push({ order, company, from: OrderStatus.CUSTOMER_CONFIRMED, to: OrderStatus.APPROVED });
    },
  });
  assert.deepEqual(result, { scanned: 1, released: 1, skipped: 0, failed: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].from, OrderStatus.CUSTOMER_CONFIRMED);
  assert.equal(calls[0].to, OrderStatus.APPROVED);
});

test("inactive companies and special-order states are not released by the recovery worker", async () => {
  const specialOrder = { ...pendingOrder, id: 42, workflowStatus: OrderStatus.PENDING_APPROVAL };
  let transitionCalls = 0;
  const result = await retryCustomerConfirmations({
    list: async () => [pendingOrder, specialOrder],
    getCompany: async () => ({ ...activeCompany, active: false }),
    release: async () => { transitionCalls++; },
  });
  assert.deepEqual(result, { scanned: 2, released: 0, skipped: 2, failed: 0 });
  assert.equal(transitionCalls, 0);
});

test("a failed automatic attempt remains retryable and can succeed on a later worker pass", async () => {
  let attempts = 0;
  const ports = {
    list: async () => [pendingOrder],
    getCompany: async () => activeCompany,
    release: async () => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error("temporary"), { status: 503, code: "TEMPORARY" });
    },
  };

  const first = await retryCustomerConfirmations(ports);
  const second = await retryCustomerConfirmations(ports);
  assert.equal(first.failed, 1);
  assert.equal(second.released, 1);
  assert.equal(attempts, 2);
});
