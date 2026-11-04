import assert from "node:assert/strict";
import { mock, test } from "node:test";

process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

const [{ db }, { runWithTenant }, { OrdersService }, { OrderStatus }] = await Promise.all([
  import("../../server/database/db"),
  import("../../server/core/tenant/context"),
  import("../../server/modules/orders/orders.service"),
  import("../../server/modules/orders/orders.workflow"),
]);

const companyId = 830_417;
const company = {
  id: companyId,
  companyName: "Empresa sintética de homologação",
  active: true,
  isLocked: false,
  adminFee: 10,
  minWeeklyBilling: "0",
};

function fixture(options: { failFirstRelease?: boolean } = {}) {
  let nextId = 1;
  let failedRelease = false;
  let deliveryCount = 0;
  const orders = new Map<number, { order: any; items: any[] }>();
  const slotIds = new Map<string, number>();
  const createdItems: any[][] = [];
  const repository: any = {
    getSetting: async () => null,
    getCompany: async (id: number) => id === companyId ? company : null,
    getProductById: async (id: number) => ({ id, basePrice: "10.00" }),
    getContractScope: async () => null,
    listByCompanyId: async () => [],
    lockCreationSlot: async () => undefined,
    findForCreationSlot: async (_tenant: number, date: string) => {
      const id = slotIds.get(date);
      if (!id) return [];
      const stored = orders.get(id)!;
      return [{ order: stored.order, items: stored.items }];
    },
    create: async (inputOrder: any, items: any[]) => {
      const id = nextId++;
      const row = {
        id,
        ...inputOrder,
        deliveryDate: new Date(inputOrder.deliveryDate),
      };
      const date = row.deliveryDate.toISOString().slice(0, 10);
      orders.set(id, { order: row, items: structuredClone(items) });
      slotIds.set(date, id);
      createdItems.push(structuredClone(items));
      return row;
    },
    get: async (id: number) => {
      const stored = orders.get(id);
      return stored
        ? { order: { ...stored.order }, items: structuredClone(stored.items) }
        : null;
    },
    executeTransition: async (input: any) => {
      if (options.failFirstRelease && !failedRelease) {
        failedRelease = true;
        throw Object.assign(new Error("Falha transitória sintética"), { status: 503 });
      }
      const stored = orders.get(input.orderId)!;
      stored.order.workflowStatus = input.to;
      stored.order.status = "CONFIRMED";
      deliveryCount++;
      return {
        updatedOrder: { ...stored.order },
        preNotaNumber: null,
        deliveryCreated: true,
        deliveryUpdated: false,
      };
    },
  };
  const service = new OrdersService(repository);
  (service as any).afterCreate = async () => undefined;
  return { service, orders, createdItems, get deliveryCount() { return deliveryCount; } };
}

function request(days: number, companyOverride = companyId) {
  return {
    days: Array.from({ length: days }, (_, index) => ({
      // Adversarial body value: service must use the authenticated tenant.
      companyId: companyOverride,
      deliveryDate: `2026-11-${String(10 + index).padStart(2, "0")}T12:00:00.000Z`,
      weekReference: "synthetic-week-2026-11",
      totalValue: "1998.00",
      orderNote: null,
      items: [{
        productId: index + 1,
        quantity: 2,
        unitPrice: "999.00",
        totalPrice: "1998.00",
      }],
    })),
  } as any;
}

function withCompanyTenant<T>(fn: () => Promise<T>) {
  return runWithTenant(
    { principal: { kind: "company", empresaId: companyId }, empresaId: companyId },
    fn,
  );
}

test("weekly confirmation creates independent daily orders, reprices on the server, and ignores body tenant", async () => {
  const transactionMock = mock.method(db, "transaction", async (callback: any) => callback({}) as any);
  const state = fixture();
  try {
    const result = await withCompanyTenant(() => state.service.createProgramacao(request(2, companyId + 1), { companyId }));

    assert.equal(result.orders.length, 2);
    assert.equal(new Set(result.orders.map((row: any) => row.id)).size, 2);
    assert.ok(result.orders.every((row: any) => row.companyId === companyId));
    assert.ok(result.orders.every((row: any) => row.workflowStatus === OrderStatus.APPROVED));
    assert.ok(result.orders.every((row: any) => row.operationalReleasePending === false));
    assert.equal(state.deliveryCount, 2);
    assert.deepEqual(state.createdItems.map((items) => items[0]), [
      { productId: 1, quantity: 2, unitPrice: "11.00", totalPrice: "22.00" },
      { productId: 2, quantity: 2, unitPrice: "11.00", totalPrice: "22.00" },
    ]);

    const replay = await withCompanyTenant(() => state.service.createProgramacao(request(2, companyId + 1), { companyId }));
    assert.deepEqual(replay.orders.map((row: any) => row.id), result.orders.map((row: any) => row.id));
    assert.equal(state.orders.size, 2);
    assert.equal(state.deliveryCount, 2);
  } finally {
    transactionMock.mock.restore();
  }
});

test("temporary release failure returns a resumable confirmation and retry does not duplicate the order", async () => {
  const transactionMock = mock.method(db, "transaction", async (callback: any) => callback({}) as any);
  const state = fixture({ failFirstRelease: true });
  try {
    const first = await withCompanyTenant(() => state.service.createProgramacao(request(1), { companyId }));
    assert.equal(first.orders.length, 1);
    assert.equal(first.orders[0].workflowStatus, OrderStatus.CUSTOMER_CONFIRMED);
    assert.equal(first.orders[0].operationalReleasePending, true);
    assert.equal(state.orders.size, 1);
    assert.equal(state.deliveryCount, 0);

    const retry = await withCompanyTenant(() => state.service.createProgramacao(request(1), { companyId }));
    assert.equal(retry.orders.length, 1);
    assert.equal(retry.orders[0].id, first.orders[0].id);
    assert.equal(retry.orders[0].workflowStatus, OrderStatus.APPROVED);
    assert.equal(retry.orders[0].operationalReleasePending, false);
    assert.equal(state.orders.size, 1);
    assert.equal(state.deliveryCount, 1);
  } finally {
    transactionMock.mock.restore();
  }
});
