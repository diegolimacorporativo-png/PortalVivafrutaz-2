import { db } from "../../database/db";
import { sql } from "drizzle-orm";
import {
  getFaturamentoContext,
  type FaturamentoContext,
} from "./faturamento.engine";

export type CanEmitNFeResult = {
  allowed: boolean;
  reason?: string;
  /** STEP 9.2Z — contexto da engine de faturamento (sempre presente quando o pedido existir). */
  faturamento?: FaturamentoContext;
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
  // STEP 9.2Z — selecionamos os campos extras que a engine usa
  // (client_type, billing_term, payment_dates) sem alterar o schema.
  const result = await db.execute(sql`
    SELECT
      o.id,
      o.status,
      o.fiscal_status,
      o.delivery_date,
      c.client_type,
      c.billing_term,
      c.payment_dates,
      c.contract_start_date,
      c.contract_end_date
    FROM orders o
    JOIN companies c ON c.id = o.company_id
    WHERE o.id = ${orderId}
  `);

  const row = (result as any).rows?.[0];

  if (!row) {
    return { allowed: false, reason: "Pedido não encontrado" };
  }

  // Separa em "order" e "company" para a engine, sem segundo round-trip ao banco.
  const order = {
    id: row.id,
    status: row.status,
    fiscal_status: row.fiscal_status,
    delivery_date: row.delivery_date,
  };
  const company = {
    client_type: row.client_type,
    billing_term: row.billing_term,
    payment_dates: row.payment_dates,
    contract_start_date: row.contract_start_date,
    contract_end_date: row.contract_end_date,
  };

  // Engine sempre roda — fornece o contexto mesmo quando bloqueado, para a UI.
  const faturamento = getFaturamentoContext(company, order);

  if (order.status === "CANCELLED") {
    return {
      allowed: false,
      reason: "Pedido cancelado não pode emitir NF",
      faturamento,
    };
  }

  if (order.fiscal_status !== "nota_liberada") {
    return {
      allowed: false,
      reason: "Pedido ainda não foi liberado para emissão fiscal",
      faturamento,
    };
  }

  if (!order.delivery_date) {
    return {
      allowed: false,
      reason: "Pedido sem data de entrega definida",
      faturamento,
    };
  }

  // Engine pode bloquear por regras comerciais (ex: contrato expirado).
  if (!faturamento.podeEmitir) {
    return {
      allowed: false,
      reason: faturamento.motivo,
      faturamento,
    };
  }

  return { allowed: true, faturamento };
}
