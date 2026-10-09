export type DeliveryCompletionActor = {
  id: number;
  name?: string | null;
  email?: string | null;
  role?: string | null;
};

export type DeliveryCompletionLink = {
  id: number;
  orderId: number | null;
  companyId: number | null;
  routeId: number | null;
};

export type DeliveryCompletionRow = DeliveryCompletionLink & {
  status: string;
  deliveredAt?: Date | null;
  stopStatus?: string | null;
  stopStatusAt?: Date | null;
  stopStatusBy?: string | null;
  stopStatusByRole?: string | null;
  stopObservacao?: string | null;
};

export type DeliveryCompletionOrder = {
  id: number;
  companyId: number;
  workflowStatus: string;
  status: string;
};

export type OrderDeliveryForCompletion = {
  id: number;
  companyId: number | null;
  status: string;
  routeId: number | null;
  routeCompanyId: number | null;
};

export type DeliveryStopEventInput = {
  deliveryId: number;
  status: "entregue";
  observacao: string | null;
  registeredAt: Date;
  registeredById: number;
  registeredBy: string | null;
  registeredByRole: string | null;
};

export interface DeliveryCompletionTransaction {
  findDeliveryLink(
    deliveryId: number,
    tenantId: number | null,
  ): Promise<DeliveryCompletionLink | undefined>;
  lockOrderSerialization(orderId: number): Promise<void>;
  lockOrder(orderId: number): Promise<DeliveryCompletionOrder | undefined>;
  lockDelivery(
    deliveryId: number,
    tenantId: number | null,
  ): Promise<DeliveryCompletionRow | undefined>;
  getRouteCompany(routeId: number): Promise<number | null | undefined>;
  getDeliveriesForOrder(orderId: number): Promise<OrderDeliveryForCompletion[]>;
  hasDeliveredEvent(deliveryId: number): Promise<boolean>;
  markDeliveryTerminal(input: {
    deliveryId: number;
    companyId: number | null;
    status: "entregue" | "cancelado";
    additionalUpdates?: Record<string, unknown>;
    preserveTerminalState?: boolean;
    now: Date;
    actor: DeliveryCompletionActor;
    observacao: string | null;
  }): Promise<DeliveryCompletionRow | undefined>;
  insertDeliveredEvent(input: DeliveryStopEventInput): Promise<void>;
  markOrderDelivered(orderId: number, companyId: number): Promise<boolean>;
}

export interface DeliveryCompletionStore {
  transaction<T>(
    work: (tx: DeliveryCompletionTransaction) => Promise<T>,
  ): Promise<T>;
}

export class DeliveryCompletionLinkError extends Error {
  constructor(message = "O vínculo entre entrega, pedido, empresa e rota é inconsistente.") {
    super(message);
    this.name = "DeliveryCompletionLinkError";
  }
}

export class DeliveryCompletionConflictError extends Error {
  constructor(message = "A entrega foi alterada simultaneamente. Recarregue e tente novamente.") {
    super(message);
    this.name = "DeliveryCompletionConflictError";
  }
}

export type DeliveryCompletionResult = {
  delivery: DeliveryCompletionRow;
  changed: boolean;
  orderFinalized: boolean;
};

const TERMINAL_DELIVERY_STATUSES = new Set(["entregue", "cancelado"]);

/**
 * Completes or cancels a delivery atomically. An order is finalized only after
 * every linked delivery is either delivered or cancelled.
 */
export async function completeDelivery(
  store: DeliveryCompletionStore,
  input: {
    deliveryId: number;
    tenantId: number | null;
    actor: DeliveryCompletionActor;
    status?: "entregue" | "cancelado";
    additionalUpdates?: Record<string, unknown>;
    observacao?: string | null;
    now?: Date;
  },
): Promise<DeliveryCompletionResult | null> {
  return store.transaction(async (tx) => {
    const link = await tx.findDeliveryLink(input.deliveryId, input.tenantId);
    if (!link) return null;

    // Order workflows use this same transaction-level lock. Acquire it before
    // locking the delivery row so concurrent order/delivery transitions serialize
    // without taking locks in opposite order.
    if (link.orderId != null) {
      await tx.lockOrderSerialization(link.orderId);
    }

    const order = link.orderId == null
      ? undefined
      : await tx.lockOrder(link.orderId);
    const delivery = await tx.lockDelivery(input.deliveryId, input.tenantId);
    if (!delivery) return null;

    if (
      delivery.orderId !== link.orderId ||
      delivery.companyId !== link.companyId ||
      delivery.routeId !== link.routeId
    ) {
      throw new DeliveryCompletionConflictError();
    }

    if (delivery.orderId != null && !order) {
      throw new DeliveryCompletionLinkError();
    }

    const effectiveCompanyId = delivery.companyId ?? order?.companyId ?? null;
    if (
      effectiveCompanyId == null ||
      (input.tenantId != null && effectiveCompanyId !== input.tenantId) ||
      (order != null && order.companyId !== effectiveCompanyId)
    ) {
      throw new DeliveryCompletionLinkError();
    }

    let siblingDeliveries: OrderDeliveryForCompletion[] = [];
    if (order) {
      siblingDeliveries = await tx.getDeliveriesForOrder(order.id);
      validateOrderDeliveryLinks(siblingDeliveries, order.companyId, delivery.id);
    } else if (delivery.routeId != null) {
      const routeCompanyId = await tx.getRouteCompany(delivery.routeId);
      if (routeCompanyId == null || routeCompanyId !== effectiveCompanyId) {
        throw new DeliveryCompletionLinkError();
      }
    }

    const now = input.now ?? new Date();
    const observacao = input.observacao?.trim() || null;
    const targetStatus = input.status ?? "entregue";
    const alreadyAtTarget = delivery.status === targetStatus;
    let changed = false;
    let completedDelivery = delivery;

    // A retry of a completion that predates this atomic flow may find the
    // delivery already delivered but missing its event. Add that event once,
    // using the delivery's original completion timestamp when available.
    if (targetStatus === "entregue" && alreadyAtTarget) {
      if (!(await tx.hasDeliveredEvent(delivery.id))) {
        await tx.insertDeliveredEvent({
          deliveryId: delivery.id,
          status: "entregue",
          observacao: delivery.stopObservacao ?? observacao,
          registeredAt: delivery.deliveredAt ?? delivery.stopStatusAt ?? now,
          registeredById: input.actor.id,
          registeredBy: input.actor.name || input.actor.email || null,
          registeredByRole: input.actor.role || null,
        });
        changed = true;
      }
    } else {
      if (!alreadyAtTarget) {
        const updatedDelivery = await tx.markDeliveryTerminal({
          deliveryId: delivery.id,
          companyId: delivery.companyId,
          status: targetStatus,
          additionalUpdates: input.additionalUpdates,
          now,
          actor: input.actor,
          observacao,
        });
        if (!updatedDelivery) {
          throw new DeliveryCompletionConflictError();
        }
        completedDelivery = updatedDelivery;
        changed = true;
      }

      if (targetStatus === "entregue") {
        await tx.insertDeliveredEvent({
          deliveryId: delivery.id,
          status: "entregue",
          observacao,
          registeredAt: now,
          registeredById: input.actor.id,
          registeredBy: input.actor.name || input.actor.email || null,
          registeredByRole: input.actor.role || null,
        });
        changed = true;
      }
    }

    if (
      alreadyAtTarget &&
      Object.keys(input.additionalUpdates ?? {}).length > 0
    ) {
      const updatedDelivery = await tx.markDeliveryTerminal({
        deliveryId: delivery.id,
        companyId: delivery.companyId,
        status: targetStatus,
        additionalUpdates: input.additionalUpdates,
        preserveTerminalState: true,
        now,
        actor: input.actor,
        observacao,
      });
      if (!updatedDelivery) {
        throw new DeliveryCompletionConflictError();
      }
      completedDelivery = updatedDelivery;
      changed = true;
    }

    let orderFinalized = false;
    if (order) {
      // Re-read after the delivery update so the terminal-state check includes
      // this transaction's own write and sees the latest committed sibling rows.
      const currentDeliveries = alreadyAtTarget
        ? siblingDeliveries
        : await tx.getDeliveriesForOrder(order.id);
      validateOrderDeliveryLinks(currentDeliveries, order.companyId, delivery.id);
      const allDeliveriesClosed =
        currentDeliveries.length > 0 &&
        currentDeliveries.every((row) => TERMINAL_DELIVERY_STATUSES.has(row.status));

      if (allDeliveriesClosed && order.workflowStatus === "SHIPPED") {
        orderFinalized = await tx.markOrderDelivered(order.id, order.companyId);
        if (!orderFinalized) {
          throw new DeliveryCompletionConflictError(
            "O pedido mudou durante a conclusão da entrega. Tente novamente.",
          );
        }
        changed = true;
      }
    }

    return {
      delivery: completedDelivery,
      changed,
      orderFinalized,
    };
  });
}

function validateOrderDeliveryLinks(
  deliveries: OrderDeliveryForCompletion[],
  orderCompanyId: number,
  currentDeliveryId: number,
): void {
  if (!deliveries.some((row) => row.id === currentDeliveryId)) {
    throw new DeliveryCompletionLinkError();
  }

  for (const delivery of deliveries) {
    const effectiveCompanyId = delivery.companyId ?? orderCompanyId;
    if (
      effectiveCompanyId !== orderCompanyId ||
      (delivery.routeId != null && delivery.routeCompanyId !== orderCompanyId)
    ) {
      throw new DeliveryCompletionLinkError();
    }
  }
}
