/**
 * FASE 18 — Guard de idempotência de emissão de NF-e (GAP 2 — duplicação sequencial).
 *
 * Decide, por EXISTÊNCIA, se um pedido já tem qualquer NFe em status bloqueante.
 * Não usa ORDER BY/LIMIT 1 sobre a "última" NFe — verifica TODO o histórico
 * de NFes do pedido. Isso protege contra cenários com múltiplas NFes
 * históricas onde a mais recente é cancelada/denegada mas existe uma
 * autorizada anterior.
 *
 * Status bloqueantes (regra conservadora aprovada na FASE 17):
 *   gerada, assinada, enviada, autorizada, rejeitada, erro
 *
 * Status liberadores (permitem nova emissão):
 *   inexistente, cancelada, denegada
 *
 * Esta função NÃO escreve nada. Faz uma única query SELECT.
 *
 * IMPORTANTE: este guard NÃO deve ser chamado dentro de canEmitNFe — esse
 * é usado em contextos de validação/preview que não representam emissão
 * real. O guard é aplicado explicitamente nos 3 pontos de emissão:
 *   - cron de faturamento
 *   - POST /api/nfe/emitir
 *   - POST /api/nfe/emitir-lote
 *
 * Escopo: resolve apenas duplicação SEQUENCIAL (GAP 2). NÃO resolve
 * concorrência (GAP 1 e GAP 7) — esses ficam para fases futuras.
 */

import { db } from "../../database/db";
import { sql } from "drizzle-orm";

export const NFE_BLOCKING_STATUSES = [
  "gerada",
  "assinada",
  "enviando",
  "enviada",
  "autorizada",
  "rejeitada",
  "erro",
] as const;

export type NFeBlockingStatus = (typeof NFE_BLOCKING_STATUSES)[number];

export type NFeIdempotencyResult = {
  blocked: boolean;
  blockingStatus?: string;
  blockingNfeId?: number;
};

/**
 * Verifica se o pedido tem alguma NFe em status bloqueante.
 *
 * Semântica: EXISTS (não LIMIT 1 ordenado). Se houver QUALQUER NFe
 * histórica em status bloqueante, retorna { blocked: true }.
 *
 * Custo: 1 SELECT, sem efeitos colaterais.
 */
export async function hasBlockingNFe(
  orderId: number,
): Promise<NFeIdempotencyResult> {
  const result = await db.execute(sql`
    SELECT id, status
    FROM nfe_emissoes
    WHERE order_id = ${orderId}
      AND status IN (
        'gerada',
        'assinada',
        'enviando',
        'enviada',
        'autorizada',
        'rejeitada',
        'erro'
      )
    LIMIT 1
  `);

  const row = (result as any).rows?.[0];
  if (!row) {
    return { blocked: false };
  }

  return {
    blocked: true,
    blockingStatus: String(row.status),
    blockingNfeId: Number(row.id),
  };
}
