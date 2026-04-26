import { db } from "../../database/db";
import { sql } from "drizzle-orm";

export type CanEmitNFeResult = {
  allowed: boolean;
  reason?: string;
};

/**
 * STEP 9.2Y — Gate de Faturamento (sem alterar schema).
 *
 * Decide se a NF pode ser emitida para um pedido com base em:
 *   - existência do pedido
 *   - status do pedido (não pode estar CANCELLED)
 *   - status fiscal (não pode já estar emitida ou cancelada)
 *   - data de entrega (precisa estar definida)
 *   - vigência do contrato da empresa (start/end date)
 *
 * Não cria tabela, não altera schema, não cria campos novos. Apenas
 * BLOQUEIA quando alguma das regras mínimas não for satisfeita.
 */
export async function canEmitNFe(orderId: number): Promise<CanEmitNFeResult> {
  const result = await db.execute(sql`
    SELECT
      o.id,
      o.status,
      o.fiscal_status,
      o.delivery_date,
      c.contract_start_date,
      c.contract_end_date
    FROM orders o
    JOIN companies c ON c.id = o.company_id
    WHERE o.id = ${orderId}
  `);

  const order = (result as any).rows?.[0];

  if (!order) {
    return { allowed: false, reason: "Pedido não encontrado" };
  }

  if (order.status === "CANCELLED") {
    return { allowed: false, reason: "Pedido cancelado não pode emitir NF" };
  }

  if (order.fiscal_status !== "nota_liberada") {
    return {
      allowed: false,
      reason: "Pedido ainda não foi liberado para emissão fiscal",
    };
  }

  if (!order.delivery_date) {
    return { allowed: false, reason: "Pedido sem data de entrega definida" };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (order.contract_start_date) {
    const start = new Date(order.contract_start_date);
    if (start > today) {
      return {
        allowed: false,
        reason: "Contrato da empresa ainda não iniciou",
      };
    }
  }

  if (order.contract_end_date) {
    const end = new Date(order.contract_end_date);
    if (end < today) {
      return { allowed: false, reason: "Contrato da empresa expirado" };
    }
  }

  return { allowed: true };
}
