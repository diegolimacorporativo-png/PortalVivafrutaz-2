import { asc, eq } from "drizzle-orm";
import { orderItems, recurringOrderLogItems, recurringOrderLogs } from "@shared/schema";

export type ContractOccurrenceScope = { id: number; productId: number; quantity: number | null };

export async function persistContractOccurrence(
  tx: any,
  input: {
    companyId: number;
    weekKey: string;
    dayOfWeek: string;
    deliveryDate: string;
    contractId: number;
    orderId: number;
    scopes: ContractOccurrenceScope[];
    totalValue: string;
  },
) {
  const [occurrence] = await tx.insert(recurringOrderLogs).values({
    companyId: input.companyId,
    weekKey: input.weekKey,
    dayOfWeek: input.dayOfWeek,
    orderId: input.orderId,
    contractId: input.contractId,
    deliveryDate: input.deliveryDate,
    scopeCount: input.scopes.length,
    totalValue: input.totalValue,
  }).returning();

  const materializedItems = await tx.select().from(orderItems)
    .where(eq(orderItems.orderId, input.orderId)).orderBy(asc(orderItems.id));
  if (materializedItems.length !== input.scopes.length || materializedItems.some((item: any, index: number) =>
    item.productId !== input.scopes[index].productId ||
    Number(item.quantity) !== Number(input.scopes[index].quantity ?? 1))) {
    throw new Error("Itens materializados não correspondem aos escopos contratuais da ocorrência.");
  }

  await tx.insert(recurringOrderLogItems).values(input.scopes.map((scope, index) => ({
    recurringOrderLogId: occurrence.id,
    contractScopeId: scope.id,
    orderItemId: materializedItems[index].id,
    quantity: Number(scope.quantity ?? 1),
  })));
  return occurrence;
}

export function isUniqueOccurrenceConflict(error: any): boolean {
  return error?.code === "23505" || error?.cause?.code === "23505";
}
