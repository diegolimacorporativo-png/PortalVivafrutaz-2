import assert from "node:assert/strict";
import test from "node:test";
import { orderItems, recurringOrderLogItems, recurringOrderLogs } from "@shared/schema";
import { isUniqueOccurrenceConflict, persistContractOccurrence } from "../../server/modules/orders/contract-occurrence-materialization";

function makeMemoryDb() {
  let state = { nextOrderId: 1, orders: [] as any[], occurrences: [] as any[], mappings: [] as any[] };
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
        createOrder: (items: Array<{ productId: number; quantity: number }>) => {
          const id = draft.nextOrderId++;
          draft.orders.push({ id });
          items.forEach((item, index) => draft.orders.push({ orderId: id, itemId: id * 10 + index, ...item }));
          return id;
        },
        insert: (table: unknown) => ({
          values: (value: any) => {
            if (table === recurringOrderLogItems) {
              draft.mappings.push(...value);
              return Promise.resolve(value);
            }
            return { returning: async () => {
              if (table === recurringOrderLogs) {
                if (draft.occurrences.some((row) => row.companyId === value.companyId && row.weekKey === value.weekKey && row.dayOfWeek === value.dayOfWeek)) {
                  throw { code: "23505" };
                }
                const occurrence = { id: draft.occurrences.length + 1, ...value };
                draft.occurrences.push(occurrence);
                return [occurrence];
              }
              throw new Error("Unexpected insert table in mock");
            } };
          },
        }),
        select: () => ({
          from: (table: unknown) => ({
            where: () => ({
              orderBy: async () => table === orderItems
                ? draft.orders.filter((row) => row.orderId != null)
                    .filter((row) => row.orderId === draft.orders.filter((candidate) => candidate.orderId == null).at(-1)?.id)
                    .map((row) => ({ id: row.itemId, productId: row.productId, quantity: row.quantity }))
                : [],
            }),
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

const input = (orderId: number) => ({
  companyId: 10,
  weekKey: "2026-W45",
  dayOfWeek: "Segunda-feira",
  deliveryDate: "2026-11-02",
  contractId: 5,
  orderId,
  scopes: [{ id: 15, productId: 3, quantity: 4 }],
  totalValue: "20.00",
});

test("chave idempotente impede uma segunda ocorrência no mock transacional", async () => {
  const memory = makeMemoryDb();
  const materialize = () => memory.transaction(async (tx) => {
    const orderId = tx.createOrder([{ productId: 3, quantity: 4 }]);
    return persistContractOccurrence(tx, input(orderId));
  });

  const first = await materialize();
  await assert.rejects(materialize(), (error: any) => isUniqueOccurrenceConflict(error));
  assert.equal(first.orderId, 1);
  assert.equal(memory.state.orders.filter((row) => row.itemId == null).length, 1);
  assert.equal(memory.state.occurrences.length, 1);
  assert.equal(memory.state.mappings.length, 1);
});

test("tentativas simultâneas resultam em uma ocorrência e uma transação perdedora revertida no mock", async () => {
  const memory = makeMemoryDb();
  const materialize = () => memory.transaction(async (tx) => {
    const orderId = tx.createOrder([{ productId: 3, quantity: 4 }]);
    return persistContractOccurrence(tx, input(orderId));
  });
  const outcomes = await Promise.allSettled([materialize(), materialize()]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((result) => result.status === "rejected" && isUniqueOccurrenceConflict(result.reason)).length, 1);
  assert.equal(memory.state.orders.filter((row) => row.itemId == null).length, 1);
  assert.equal(memory.state.occurrences.length, 1);
  assert.equal(memory.state.mappings.length, 1);
});

test("divergência entre item e escopo falha antes de confirmar ocorrência no mock", async () => {
  const memory = makeMemoryDb();
  await assert.rejects(memory.transaction(async (tx) => {
    const orderId = tx.createOrder([{ productId: 99, quantity: 1 }]);
    return persistContractOccurrence(tx, input(orderId));
  }), /não correspondem aos escopos/);
  assert.equal(memory.state.orders.length, 0);
  assert.equal(memory.state.occurrences.length, 0);
  assert.equal(memory.state.mappings.length, 0);
});
