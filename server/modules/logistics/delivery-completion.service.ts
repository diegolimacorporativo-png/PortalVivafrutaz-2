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
  status: string;
  observacao: string | null;
  registeredAt: Date;
  registeredById: number;
  registeredBy: string | null;
  registeredByRole: string | null;
};

export type DeliveryCompletionChecklistInput = {
  deliveryId: number;
  driverId: number | null;
  entregaConfirmada: boolean;
  observacao: string | null;
  assinaturaUrl: string | null;
  fotoUrl: string | null;
  horarioEntrega: Date;
};

export type DeliveryCompletionChecklistRecord =
  Omit<DeliveryCompletionChecklistInput, "entregaConfirmada"> & {
    id: number;
    entregaConfirmada: boolean | null;
    createdAt: Date;
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
  hasStopStatusEvent(
    deliveryId: number,
    status: string,
    observacao: string | null,
    registeredAt: Date,
  ): Promise<boolean>;
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
  markDeliveryNonterminal(input: {
    deliveryId: number;
    companyId: number | null;
    status: string;
    additionalUpdates?: Record<string, unknown>;
    recordStopStatus: boolean;
    now: Date;
    actor: DeliveryCompletionActor;
    observacao: string | null;
  }): Promise<DeliveryCompletionRow | undefined>;
  insertStopStatusEvent(input: DeliveryStopEventInput): Promise<void>;
  getConfirmedChecklist(
    deliveryId: number,
  ): Promise<DeliveryCompletionChecklistRecord | undefined>;
  insertChecklist(
    input: DeliveryCompletionChecklistInput,
  ): Promise<DeliveryCompletionChecklistRecord>;
  markOrderDelivered(orderId: number, companyId: number): Promise<boolean>;
  deleteDelivery(deliveryId: number, companyId: number | null): Promise<boolean>;
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
  checklist?: DeliveryCompletionChecklistRecord;
};

const TERMINAL_DELIVERY_STATUSES = new Set(["entregue", "cancelado"]);

export function areOrderDeliveriesTerminal(
  deliveries: Array<{ status: string }>,
): boolean {
  return (
    deliveries.length > 0 &&
    deliveries.every((delivery) => TERMINAL_DELIVERY_STATUSES.has(delivery.status))
  );
}

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
    checklist?: DeliveryCompletionChecklistInput;
  },
): Promise<DeliveryCompletionResult | null> {
  return store.transaction(async (tx) => {
    const context = await loadDeliveryContext(tx, input.deliveryId, input.tenantId);
    if (!context) return null;
    const { delivery, order, siblingDeliveries } = context;

    const now = input.now ?? new Date();
    const observacao = input.observacao?.trim() || null;
    const targetStatus = input.status ?? "entregue";
    let checklist: DeliveryCompletionChecklistRecord | undefined;
    if (input.checklist) {
      if (input.checklist.deliveryId !== delivery.id) {
        throw new DeliveryCompletionLinkError(
          "O checklist não corresponde à entrega concluída.",
        );
      }
      if (!input.checklist.entregaConfirmada) {
        throw new DeliveryCompletionConflictError(
          "O checklist precisa confirmar a entrega para concluir a parada.",
        );
      }
      checklist =
        (await tx.getConfirmedChecklist(delivery.id)) ??
        (await tx.insertChecklist(input.checklist));
    }

    const alreadyAtTarget = delivery.status === targetStatus;
    let changed = false;
    let completedDelivery = delivery;

    // A retry of a completion that predates this atomic flow may find the
    // delivery already delivered but missing its event. Add that event once,
    // using the delivery's original completion timestamp when available.
    if (targetStatus === "entregue" && alreadyAtTarget) {
      if (!(await tx.hasDeliveredEvent(delivery.id))) {
        await tx.insertStopStatusEvent({
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
        await tx.insertStopStatusEvent({
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
      const allDeliveriesClosed = areOrderDeliveriesTerminal(currentDeliveries);

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
      checklist,
    };
  });
}

/**
 * Applies an ordinary nonterminal status update, optionally recording a stop
 * event. The order lock is shared with workflow transitions and completion so
 * an update cannot race order finalization.
 */
export async function updateDeliveryNonterminal(
  store: DeliveryCompletionStore,
  input: {
    deliveryId: number;
    tenantId: number | null;
    actor: DeliveryCompletionActor;
    status: string;
    additionalUpdates?: Record<string, unknown>;
    recordStopEvent?: boolean;
    observacao?: string | null;
    now?: Date;
  },
): Promise<{
  delivery: DeliveryCompletionRow;
  changed: boolean;
  registeredAt: Date | null;
} | null> {
  return store.transaction(async (tx) => {
    const context = await loadDeliveryContext(tx, input.deliveryId, input.tenantId);
    if (!context) return null;
    const { delivery, order } = context;

    if (
      TERMINAL_DELIVERY_STATUSES.has(delivery.status) ||
      order?.workflowStatus === "DELIVERED"
    ) {
      throw new DeliveryCompletionConflictError(
        "Uma entrega concluída ou cancelada não pode voltar a um status pendente.",
      );
    }
    if (TERMINAL_DELIVERY_STATUSES.has(input.status)) {
      throw new DeliveryCompletionConflictError(
        "Use o fluxo de conclusão para entregar ou cancelar a parada.",
      );
    }

    const now = input.now ?? new Date();
    const observacao = input.observacao?.trim() || null;
    const recordStopEvent = input.recordStopEvent === true;

    if (
      recordStopEvent &&
      delivery.status === input.status &&
      delivery.stopStatus === input.status &&
      (delivery.stopObservacao ?? null) === observacao &&
      delivery.stopStatusAt
    ) {
      const registeredAt = delivery.stopStatusAt;
      if (
        await tx.hasStopStatusEvent(
          delivery.id,
          input.status,
          observacao,
          registeredAt,
        )
      ) {
        return { delivery, changed: false, registeredAt };
      }

      await tx.insertStopStatusEvent({
        deliveryId: delivery.id,
        status: input.status,
        observacao,
        registeredAt,
        registeredById: input.actor.id,
        registeredBy: input.actor.name || input.actor.email || null,
        registeredByRole: input.actor.role || null,
      });
      return { delivery, changed: true, registeredAt };
    }

    const updatedDelivery = await tx.markDeliveryNonterminal({
      deliveryId: delivery.id,
      companyId: delivery.companyId,
      status: input.status,
      additionalUpdates: input.additionalUpdates,
      recordStopStatus: recordStopEvent,
      now,
      actor: input.actor,
      observacao,
    });
    if (!updatedDelivery) {
      throw new DeliveryCompletionConflictError();
    }

    if (recordStopEvent) {
      await tx.insertStopStatusEvent({
        deliveryId: delivery.id,
        status: input.status,
        observacao,
        registeredAt: now,
        registeredById: input.actor.id,
        registeredBy: input.actor.name || input.actor.email || null,
        registeredByRole: input.actor.role || null,
      });
    }

    return {
      delivery: updatedDelivery,
      changed: true,
      registeredAt: recordStopEvent ? now : null,
    };
  });
}

export async function deleteDeliveryBeforeShipment(
  store: DeliveryCompletionStore,
  input: { deliveryId: number; tenantId: number | null },
): Promise<boolean | null> {
  return store.transaction(async (tx) => {
    const context = await loadDeliveryContext(tx, input.deliveryId, input.tenantId);
    if (!context) return null;
    const { delivery, order } = context;

    if (
      TERMINAL_DELIVERY_STATUSES.has(delivery.status) ||
      order?.workflowStatus === "SHIPPED" ||
      order?.workflowStatus === "DELIVERED" ||
      order?.status === "DELIVERED"
    ) {
      throw new DeliveryCompletionConflictError(
        "Não remova uma entrega expedida, concluída ou cancelada. Cancele apenas a parada quando necessário.",
      );
    }

    const deleted = await tx.deleteDelivery(delivery.id, delivery.companyId);
    if (!deleted) throw new DeliveryCompletionConflictError();
    return true;
  });
}

async function loadDeliveryContext(
  tx: DeliveryCompletionTransaction,
  deliveryId: number,
  tenantId: number | null,
): Promise<{
  delivery: DeliveryCompletionRow;
  order: DeliveryCompletionOrder | undefined;
  siblingDeliveries: OrderDeliveryForCompletion[];
} | null> {
  const link = await tx.findDeliveryLink(deliveryId, tenantId);
  if (!link) return null;

  // All delivery changes and order workflow changes take this lock first.
  if (link.orderId != null) {
    await tx.lockOrderSerialization(link.orderId);
  }

  const order = link.orderId == null
    ? undefined
    : await tx.lockOrder(link.orderId);
  const delivery = await tx.lockDelivery(deliveryId, tenantId);
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
    (tenantId != null && effectiveCompanyId !== tenantId) ||
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

  return { delivery, order, siblingDeliveries };
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
