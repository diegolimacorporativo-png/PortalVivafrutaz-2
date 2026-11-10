import assert from "node:assert/strict";
import test from "node:test";
import { materializeSpecialOrderRequest } from "../../server/modules/special-orders/special-order-materialization";

function makeMemoryDb(companyId = 10) {
  let state = { request: { id: 7, companyId, generatedOrderId: null as number | null }, orders: 0 };
  let queue = Promise.resolve();

  return {
    get state() { return state; },
    async transaction<T>(work: (tx: any) => Promise<T>): Promise<T> {
      let release!: () => void;
      const previous = queue;
      queue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const draft = structuredClone(state);
      const tx = {
        insertOrder: () => ++draft.orders,
        select: () => ({
          from: () => ({
            where: () => ({ for: async () => [draft.request] }),
          }),
        }),
        update: () => ({
          set: (patch: Record<string, unknown>) => ({
            where: () => ({ returning: async () => {
              Object.assign(draft.request, patch);
              return [draft.request];
            } }),
          }),
        }),
      };
      try {
        const result = await work(tx);
        state = draft;
        return result;
      } finally {
        release();
      }
    },
  };
}

test("aprovações simultâneas da mesma solicitação materializam um único pedido", async () => {
  const memory = makeMemoryDb();
  let createCount = 0;
  const approve = () => memory.transaction((tx) => materializeSpecialOrderRequest(tx, {
    requestId: 7,
    companyId: 10,
    createOrder: async (request) => {
      createCount++;
      return { id: request.id + tx.insertOrder() };
    },
    updateForOrder: () => ({ status: "APPROVED" }),
  }));

  const results = await Promise.all([approve(), approve()]);
  assert.equal(createCount, 1);
  assert.equal(results.filter((result) => result.order !== null).length, 1);
  assert.equal(results.filter((result) => result.order === null).length, 1);
  assert.equal(memory.state.request.generatedOrderId, 8);
  assert.equal(memory.state.orders, 1);
});

test("falha ao gravar a origem reverte o pedido no limite da transação mockada", async () => {
  const memory = makeMemoryDb();
  await assert.rejects(memory.transaction((tx) => materializeSpecialOrderRequest(tx, {
    requestId: 7,
    companyId: 10,
    createOrder: async () => { tx.insertOrder(); return { id: 80 }; },
    updateForOrder: () => { throw new Error("simulated origin-write failure"); },
  })), /simulated origin-write failure/);
  assert.equal(memory.state.request.generatedOrderId, null);
  assert.equal(memory.state.orders, 0);
  // This test double models transactional rollback; only PostgreSQL can prove
  // the corresponding database rollback/locking behavior.
});

test("a solicitação de outra empresa não é materializada", async () => {
  const memory = makeMemoryDb(10);
  let createCount = 0;
  await assert.rejects(memory.transaction((tx) => materializeSpecialOrderRequest(tx, {
    requestId: 7,
    companyId: 20,
    createOrder: async () => { createCount++; return { id: 80 }; },
    updateForOrder: () => ({ status: "APPROVED" }),
  })), /escopo autorizado/);
  assert.equal(createCount, 0);
  assert.equal(memory.state.request.generatedOrderId, null);
});
