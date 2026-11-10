import { eq } from "drizzle-orm";
import { specialOrderRequests } from "@shared/schema";

type MaterializeSpecialOrderInput<TOrder> = {
  requestId: number;
  companyId: number;
  createOrder: (request: any) => Promise<TOrder & { id: number }>;
  updateForOrder: (order: TOrder & { id: number }, request: any) => Record<string, unknown>;
};

/**
 * Lock the source request, create its order and save the provenance pointer
 * using the caller's transaction. A retry that sees the pointer is a no-op.
 */
export async function materializeSpecialOrderRequest<TOrder extends { id: number }>(
  tx: any,
  input: MaterializeSpecialOrderInput<TOrder>,
): Promise<{ order: TOrder | null; request: any }> {
  const [request] = await tx.select().from(specialOrderRequests)
    .where(eq(specialOrderRequests.id, input.requestId)).for("update");
  if (!request || request.companyId !== input.companyId) {
    throw new Error("Solicitação pontual não encontrada no escopo autorizado.");
  }
  if (request.generatedOrderId) return { order: null, request };

  const order = await input.createOrder(request);
  const [updatedRequest] = await tx.update(specialOrderRequests)
    .set({ ...input.updateForOrder(order, request), generatedOrderId: order.id })
    .where(eq(specialOrderRequests.id, input.requestId)).returning();
  if (!updatedRequest) throw new Error("Não foi possível registrar a origem do pedido pontual.");
  return { order, request: updatedRequest };
}
