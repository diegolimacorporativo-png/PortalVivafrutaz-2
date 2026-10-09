import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  completeDelivery,
  DeliveryCompletionLinkError,
  type DeliveryCompletionActor,
  type DeliveryCompletionOrder,
  type DeliveryCompletionRow,
  type DeliveryCompletionStore,
  type DeliveryCompletionTransaction,
  type OrderDeliveryForCompletion,
  type DeliveryStopEventInput,
} from "../../server/modules/logistics/delivery-completion.service";

type TestOrder = DeliveryCompletionOrder & {
  fiscalStatus: string;
  fiscalReference: string;
};

type TestState = {
  orders: TestOrder[];
  deliveries: DeliveryCompletionRow[];
  routes: Array<{ id: number; companyId: number | null }>;
  events: DeliveryStopEventInput[];
};

class MemoryCompletionStore implements DeliveryCompletionStore {
  state: TestState;
  failAt: "event" | "finalize" | null = null;
  lockCalls: string[] = [];

  constructor(state: TestState) {
    this.state = state;
  }

  async transaction<T>(
    work: (tx: DeliveryCompletionTransaction) => Promise<T>,
  ): Promise<T> {
    const draft = structuredClone(this.state);
    const tx: DeliveryCompletionTransaction = {
      findDeliveryLink: async (deliveryId, tenantId) => {
        const row = draft.deliveries.find((candidate) => candidate.id === deliveryId);
        if (!row || (tenantId != null && row.companyId !== tenantId)) return undefined;
        return {
          id: row.id,
          orderId: row.orderId,
          companyId: row.companyId,
          routeId: row.routeId,
        };
      },
      lockOrderSerialization: async (orderId) => {
        this.lockCalls.push(`advisory:${orderId}`);
      },
      lockOrder: async (orderId) => {
        this.lockCalls.push(`order:${orderId}`);
        return draft.orders.find((order) => order.id === orderId);
      },
      lockDelivery: async (deliveryId, tenantId) => {
        this.lockCalls.push(`delivery:${deliveryId}`);
        const row = draft.deliveries.find((candidate) => candidate.id === deliveryId);
        if (!row || (tenantId != null && row.companyId !== tenantId)) return undefined;
        return row;
      },
      getRouteCompany: async (routeId) =>
        draft.routes.find((route) => route.id === routeId)?.companyId,
      getDeliveriesForOrder: async (orderId): Promise<OrderDeliveryForCompletion[]> =>
        draft.deliveries
          .filter((row) => row.orderId === orderId)
          .map((row) => ({
            id: row.id,
            companyId: row.companyId,
            status: row.status,
            routeId: row.routeId,
            routeCompanyId:
              row.routeId == null
                ? null
                : draft.routes.find((route) => route.id === row.routeId)?.companyId ?? null,
          })),
      hasDeliveredEvent: async (deliveryId) =>
        draft.events.some(
          (event) => event.deliveryId === deliveryId && event.status === "entregue",
        ),
      markDeliveryTerminal: async (input) => {
        const row = draft.deliveries.find(
          (candidate) =>
            candidate.id === input.deliveryId &&
            candidate.companyId === input.companyId,
        );
        if (!row) return undefined;
        if (input.preserveTerminalState) {
          Object.assign(row, input.additionalUpdates);
        } else if (input.status === "entregue") {
          Object.assign(row, {
            ...input.additionalUpdates,
            status: "entregue",
            deliveredAt: input.now,
            stopStatus: "entregue",
            stopStatusAt: input.now,
            stopStatusBy: input.actor.name || input.actor.email || null,
            stopStatusByRole: input.actor.role || null,
            stopObservacao: input.observacao,
          });
        } else {
          Object.assign(row, {
            ...input.additionalUpdates,
            status: "cancelado",
          });
        }
        return row;
      },
      insertDeliveredEvent: async (event) => {
        if (this.failAt === "event") throw new Error("event insert failed");
        draft.events.push(event);
      },
      markOrderDelivered: async (orderId, companyId) => {
        if (this.failAt === "finalize") throw new Error("order update failed");
        const order = draft.orders.find(
          (candidate) =>
            candidate.id === orderId &&
            candidate.companyId === companyId &&
            candidate.workflowStatus === "SHIPPED",
        );
        if (!order) return false;
        order.status = "DELIVERED";
        order.workflowStatus = "DELIVERED";
        return true;
      },
    };

    const result = await work(tx);
    this.state = draft;
    return result;
  }
}

const actor: DeliveryCompletionActor = {
  id: 700,
  name: "Motorista de teste",
  email: "driver@example.test",
  role: "DRIVER",
};
const completedAt = new Date("2026-10-09T12:00:00.000Z");

function makeStore(statuses = ["em_rota"]): MemoryCompletionStore {
  const orders: TestOrder[] = [
    {
      id: 1,
      companyId: 10,
      workflowStatus: "SHIPPED",
      status: "CONFIRMED",
      fiscalStatus: "nota_pendente",
      fiscalReference: "fiscal-value-must-not-change",
    },
  ];
  const deliveries: DeliveryCompletionRow[] = statuses.map((status, index) => ({
    id: 101 + index,
    orderId: 1,
    companyId: 10,
    routeId: 50 + index,
    status,
    deliveredAt: status === "entregue" ? new Date("2026-10-08T10:00:00.000Z") : null,
    stopStatus: null,
    stopStatusAt: null,
    stopStatusBy: null,
    stopStatusByRole: null,
    stopObservacao: null,
  }));
  const routes = statuses.map((_, index) => ({
    id: 50 + index,
    companyId: 10,
  }));
  return new MemoryCompletionStore({
    orders,
    deliveries,
    routes,
    events: [],
  });
}

function complete(
  store: MemoryCompletionStore,
  deliveryId = 101,
  tenantId: number | null = 10,
) {
  return completeDelivery(store, {
    deliveryId,
    tenantId,
    actor,
    observacao: "  Recebido pelo cliente  ",
    now: completedAt,
  });
}

describe("conclusão transacional de entregas", () => {
  test("uma única entrega conclui o pedido e grava evento sem tocar nos campos fiscais", async () => {
    const store = makeStore();
    const fiscalBefore = {
      fiscalStatus: store.state.orders[0].fiscalStatus,
      fiscalReference: store.state.orders[0].fiscalReference,
    };

    const result = await complete(store);

    assert.equal(result?.delivery.status, "entregue");
    assert.equal(result?.delivery.stopStatus, "entregue");
    assert.equal(result?.orderFinalized, true);
    assert.equal(store.state.events.length, 1);
    assert.equal(store.state.events[0].observacao, "Recebido pelo cliente");
    assert.deepEqual(
      {
        fiscalStatus: store.state.orders[0].fiscalStatus,
        fiscalReference: store.state.orders[0].fiscalReference,
      },
      fiscalBefore,
    );
    assert.equal(store.state.orders[0].workflowStatus, "DELIVERED");
    assert.equal(store.state.orders[0].status, "DELIVERED");
  });

  test("campos editáveis enviados junto da conclusão também ficam na mesma transação", async () => {
    const store = makeStore();

    const result = await completeDelivery(store, {
      deliveryId: 101,
      tenantId: 10,
      actor,
      additionalUpdates: { notes: "Portaria lateral" },
      now: completedAt,
    });

    assert.equal(result?.delivery.status, "entregue");
    assert.equal((result?.delivery as any).notes, "Portaria lateral");
    assert.equal(store.state.events.length, 1);
  });

  test("editar metadados de uma entrega já concluída não altera seu horário original", async () => {
    const store = makeStore(["entregue"]);
    const originalDeliveredAt = store.state.deliveries[0].deliveredAt;
    store.state.events.push({
      deliveryId: 101,
      status: "entregue",
      observacao: null,
      registeredAt: originalDeliveredAt!,
      registeredById: actor.id,
      registeredBy: actor.name ?? null,
      registeredByRole: actor.role ?? null,
    });

    const result = await completeDelivery(store, {
      deliveryId: 101,
      tenantId: 10,
      actor,
      additionalUpdates: { notes: "Editar observação" },
      now: completedAt,
    });

    assert.equal((result?.delivery as any).notes, "Editar observação");
    assert.equal(result?.delivery.deliveredAt?.getTime(), originalDeliveredAt?.getTime());
    assert.equal(store.state.events.length, 1);
  });

  test("a primeira de várias entregas não conclui o pedido", async () => {
    const store = makeStore(["em_rota", "pendente"]);

    const result = await complete(store, 101);

    assert.equal(result?.orderFinalized, false);
    assert.equal(store.state.deliveries[0].status, "entregue");
    assert.equal(store.state.deliveries[1].status, "pendente");
    assert.equal(store.state.orders[0].workflowStatus, "SHIPPED");
    assert.equal(store.state.orders[0].status, "CONFIRMED");
    assert.equal(store.state.events.length, 1);
  });

  test("a última entrega pendente conclui o pedido e preserva a entrega cancelada", async () => {
    const store = makeStore(["entregue", "cancelado", "em_rota"]);

    const result = await complete(store, 103);

    assert.equal(result?.orderFinalized, true);
    assert.equal(store.state.orders[0].workflowStatus, "DELIVERED");
    assert.equal(store.state.deliveries[0].status, "entregue");
    assert.equal(store.state.deliveries[1].status, "cancelado");
    assert.equal(store.state.deliveries[2].status, "entregue");
  });

  test("cancelar a última entrega pendente também conclui o pedido", async () => {
    const store = makeStore(["entregue", "cancelado", "em_rota"]);

    const result = await completeDelivery(store, {
      deliveryId: 103,
      tenantId: 10,
      actor,
      status: "cancelado",
      now: completedAt,
    });

    assert.equal(result?.orderFinalized, true);
    assert.equal(store.state.orders[0].workflowStatus, "DELIVERED");
    assert.equal(store.state.deliveries[2].status, "cancelado");
    assert.equal(store.state.events.length, 0);
  });

  test("repetir a conclusão não duplica o evento nem refaz a transição", async () => {
    const store = makeStore();

    await complete(store);
    const repeated = await complete(store);

    assert.equal(repeated?.changed, false);
    assert.equal(repeated?.orderFinalized, false);
    assert.equal(store.state.events.length, 1);
    assert.equal(store.state.orders[0].workflowStatus, "DELIVERED");
  });

  test("entrega já concluída sem histórico recebe um único evento no retry", async () => {
    const store = makeStore(["entregue"]);
    const originalDeliveredAt = store.state.deliveries[0].deliveredAt;

    const result = await complete(store);
    await complete(store);

    assert.equal(result?.changed, true);
    assert.equal(store.state.events.length, 1);
    assert.equal(store.state.events[0].registeredAt.getTime(), originalDeliveredAt?.getTime());
    assert.equal(store.state.deliveries[0].deliveredAt?.getTime(), originalDeliveredAt?.getTime());
    assert.equal(store.state.orders[0].workflowStatus, "DELIVERED");
  });

  test("falha ao inserir evento desfaz status, histórico e pedido", async () => {
    const store = makeStore();
    store.failAt = "event";

    await assert.rejects(() => complete(store), /event insert failed/);

    assert.equal(store.state.deliveries[0].status, "em_rota");
    assert.equal(store.state.events.length, 0);
    assert.equal(store.state.orders[0].workflowStatus, "SHIPPED");
  });

  test("falha ao finalizar o pedido desfaz também a entrega e o evento", async () => {
    const store = makeStore();
    store.failAt = "finalize";

    await assert.rejects(() => complete(store), /order update failed/);

    assert.equal(store.state.deliveries[0].status, "em_rota");
    assert.equal(store.state.events.length, 0);
    assert.equal(store.state.orders[0].workflowStatus, "SHIPPED");
  });

  test("tenant diferente não encontra nem altera a entrega", async () => {
    const store = makeStore();
    const result = await complete(store, 101, 20);

    assert.equal(result, null);
    assert.equal(store.state.deliveries[0].status, "em_rota");
    assert.equal(store.state.events.length, 0);
  });

  test("vínculo de outra empresa em uma entrega irmã bloqueia toda a transação", async () => {
    const store = makeStore(["em_rota", "pendente"]);
    store.state.deliveries[1].companyId = 20;
    store.state.routes[1].companyId = 20;

    await assert.rejects(
      () => complete(store),
      (error: unknown) => error instanceof DeliveryCompletionLinkError,
    );

    assert.equal(store.state.deliveries[0].status, "em_rota");
    assert.equal(store.state.events.length, 0);
    assert.equal(store.state.orders[0].workflowStatus, "SHIPPED");
  });

  test("rota de outra empresa bloqueia a conclusão antes de qualquer gravação", async () => {
    const store = makeStore();
    store.state.routes[0].companyId = 20;

    await assert.rejects(
      () => complete(store),
      (error: unknown) => error instanceof DeliveryCompletionLinkError,
    );

    assert.equal(store.state.deliveries[0].status, "em_rota");
    assert.equal(store.state.events.length, 0);
  });

  test("o bloqueio do pedido é adquirido antes dos bloqueios de linha", async () => {
    const store = makeStore();
    await complete(store);

    assert.deepEqual(store.lockCalls.slice(0, 3), [
      "advisory:1",
      "order:1",
      "delivery:101",
    ]);
  });
});
