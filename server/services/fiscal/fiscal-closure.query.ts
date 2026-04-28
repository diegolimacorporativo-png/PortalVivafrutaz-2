/**
 * FASE NF.7.9.8 — Listagem read-only de meses fiscais já fechados.
 *
 * Camada puramente aditiva. NÃO substitui nem depende do
 * fiscal-closure.service.ts (closePeriod / isPeriodClosed). Existe apenas
 * para EXPOR os fechamentos persistidos em `fiscal_closures` ao frontend
 * (base para o badge persistente da próxima fase).
 *
 * Política:
 *   - Read-only: sem INSERT/UPDATE/DELETE.
 *   - Multi-tenant: SEMPRE filtra por companyId; chamador é obrigado a
 *     passar o tenant resolvido (não há fallback global).
 *   - Fail-safe: companyId inválido → array vazio (mesmo padrão do service
 *     irmão `isPeriodClosed`, que devolve `false` para entrada inválida).
 *   - Ordenação: mais recente primeiro (year DESC, month DESC) — formato
 *     direto consumível pela UI sem reordenação no cliente.
 */
import { db } from "../../database/db";
import { fiscalClosures } from "@shared/schema";
import { desc, eq } from "drizzle-orm";

export interface ClosedPeriod {
  year: number;
  month: number;
  closedAt: Date | null;
}

export async function listClosedPeriods(
  companyId: number,
): Promise<ClosedPeriod[]> {
  if (!Number.isInteger(companyId) || companyId <= 0) return [];

  const rows = await db
    .select({
      year: fiscalClosures.year,
      month: fiscalClosures.month,
      closedAt: fiscalClosures.closedAt,
    })
    .from(fiscalClosures)
    .where(eq(fiscalClosures.companyId, companyId))
    .orderBy(desc(fiscalClosures.year), desc(fiscalClosures.month));

  return rows;
}
