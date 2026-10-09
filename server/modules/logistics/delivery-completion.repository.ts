import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../database/db";
import {
  deliveries,
  deliveryStopEvents,
  deliveryChecklists,
  logisticsRoutes,
  orders,
} from "@shared/schema";
import type {
  DeliveryCompletionStore,
  DeliveryCompletionTransaction,
} from "./delivery-completion.service";

export const deliveryCompletionStore: DeliveryCompletionStore = {
  transaction: (work) =>
    db.transaction(async (tx) => {
      const operations: DeliveryCompletionTransaction = {
        async findDeliveryLink(deliveryId, tenantId) {
          const conditions = [eq(deliveries.id, deliveryId)];
          if (tenantId != null) conditions.push(eq(deliveries.companyId, tenantId));
          const [row] = await tx
            .select({
              id: deliveries.id,
              orderId: deliveries.orderId,
              companyId: deliveries.companyId,
              routeId: deliveries.routeId,
            })
            .from(deliveries)
            .where(and(...conditions))
            .limit(1);
          return row;
        },

        async lockOrderSerialization(orderId) {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(${orderId}::bigint)`,
          );
        },

        async lockOrder(orderId) {
          const [row] = await tx
            .select({
              id: orders.id,
              companyId: orders.companyId,
              workflowStatus: orders.workflowStatus,
              status: orders.status,
            })
            .from(orders)
            .where(eq(orders.id, orderId))
            .for("update")
            .limit(1);
          return row;
        },

        async lockDelivery(deliveryId, tenantId) {
          const conditions = [eq(deliveries.id, deliveryId)];
          if (tenantId != null) conditions.push(eq(deliveries.companyId, tenantId));
          const [row] = await tx
            .select()
            .from(deliveries)
            .where(and(...conditions))
            .for("update")
            .limit(1);
          return row;
        },

        async getRouteCompany(routeId) {
          const [row] = await tx
            .select({ companyId: logisticsRoutes.empresaId })
            .from(logisticsRoutes)
            .where(eq(logisticsRoutes.id, routeId))
            .limit(1);
          return row?.companyId;
        },

        async getDeliveriesForOrder(orderId) {
          return tx
            .select({
              id: deliveries.id,
              companyId: deliveries.companyId,
              status: deliveries.status,
              routeId: deliveries.routeId,
              routeCompanyId: logisticsRoutes.empresaId,
            })
            .from(deliveries)
            .leftJoin(
              logisticsRoutes,
              eq(deliveries.routeId, logisticsRoutes.id),
            )
            .where(eq(deliveries.orderId, orderId));
        },

        async hasDeliveredEvent(deliveryId) {
          const [row] = await tx
            .select({ id: deliveryStopEvents.id })
            .from(deliveryStopEvents)
            .where(
              and(
                eq(deliveryStopEvents.deliveryId, deliveryId),
                eq(deliveryStopEvents.status, "entregue"),
              ),
            )
            .limit(1);
          return Boolean(row);
        },

        async hasStopStatusEvent(deliveryId, status, observacao, registeredAt) {
          const earliest = new Date(registeredAt.getTime() - 5_000);
          const latest = new Date(registeredAt.getTime() + 5_000);
          const [row] = await tx
            .select({ id: deliveryStopEvents.id })
            .from(deliveryStopEvents)
            .where(
              and(
                eq(deliveryStopEvents.deliveryId, deliveryId),
                eq(deliveryStopEvents.status, status),
                observacao == null
                  ? isNull(deliveryStopEvents.observacao)
                  : eq(deliveryStopEvents.observacao, observacao),
                gte(deliveryStopEvents.registeredAt, earliest),
                lte(deliveryStopEvents.registeredAt, latest),
              ),
            )
            .limit(1);
          return Boolean(row);
        },

        async markDeliveryTerminal(input) {
          const companyCondition = input.companyId == null
            ? isNull(deliveries.companyId)
            : eq(deliveries.companyId, input.companyId);
          const update = input.preserveTerminalState
            ? {
                ...input.additionalUpdates,
                updatedAt: input.now,
              }
            : input.status === "entregue"
            ? {
                ...input.additionalUpdates,
                status: "entregue" as const,
                deliveredAt: input.now,
                stopStatus: "entregue",
                stopStatusAt: input.now,
                stopStatusBy: input.actor.name || input.actor.email || null,
                stopStatusByRole: input.actor.role || null,
                stopObservacao: input.observacao,
                updatedAt: input.now,
              }
            : {
                ...input.additionalUpdates,
                status: "cancelado" as const,
                updatedAt: input.now,
              };
          const [row] = await tx
            .update(deliveries)
            .set(update as any)
            .where(and(eq(deliveries.id, input.deliveryId), companyCondition))
            .returning();
          return row;
        },

        async markDeliveryNonterminal(input) {
          const companyCondition = input.companyId == null
            ? isNull(deliveries.companyId)
            : eq(deliveries.companyId, input.companyId);
          const [row] = await tx
            .update(deliveries)
            .set({
              ...input.additionalUpdates,
              status: input.status,
              ...(input.recordStopStatus
                ? {
                    stopStatus: input.status,
                    stopStatusAt: input.now,
                    stopStatusBy: input.actor.name || input.actor.email || null,
                    stopStatusByRole: input.actor.role || null,
                    stopObservacao: input.observacao,
                  }
                : {}),
              updatedAt: input.now,
            } as any)
            .where(and(eq(deliveries.id, input.deliveryId), companyCondition))
            .returning();
          return row;
        },

        async insertStopStatusEvent(input) {
          await tx.insert(deliveryStopEvents).values(input);
        },

        async getConfirmedChecklist(deliveryId) {
          const [row] = await tx
            .select()
            .from(deliveryChecklists)
            .where(
              and(
                eq(deliveryChecklists.deliveryId, deliveryId),
                eq(deliveryChecklists.entregaConfirmada, true),
              ),
            )
            .orderBy(deliveryChecklists.createdAt)
            .limit(1);
          return row;
        },

        async insertChecklist(input) {
          const [row] = await tx
            .insert(deliveryChecklists)
            .values(input)
            .returning();
          if (!row) throw new Error("Não foi possível registrar o checklist da entrega.");
          return row;
        },

        async markOrderDelivered(orderId, companyId) {
          const [row] = await tx
            .update(orders)
            .set({ workflowStatus: "DELIVERED", status: "DELIVERED" })
            .where(
              and(
                eq(orders.id, orderId),
                eq(orders.companyId, companyId),
                eq(orders.workflowStatus, "SHIPPED"),
              ),
            )
            .returning({ id: orders.id });
          return Boolean(row);
        },

        async deleteDelivery(deliveryId, companyId) {
          const companyCondition = companyId == null
            ? isNull(deliveries.companyId)
            : eq(deliveries.companyId, companyId);
          const [row] = await tx
            .delete(deliveries)
            .where(and(eq(deliveries.id, deliveryId), companyCondition))
            .returning({ id: deliveries.id });
          return Boolean(row);
        },
      };

      return work(operations);
    }),
};
