/**
 * FASE NF.7.9.2 — Fechamento mensal fiscal (TRAVAR PERÍODO).
 *
 * Camada de proteção aditiva. Bloqueia mutações em meses já consolidados
 * (SPED enviado, contabilidade fechada). Comportamento atual permanece
 * intacto: enquanto não houver registro em `fiscal_closures` para o
 * (companyId, year, month), nada muda — `isPeriodClosed` devolve `false`
 * e o caller segue normal.
 *
 * Esta camada NÃO altera:
 *   - geração de XML (server/services/nfe/nfeGenerator.ts intocado)
 *   - cálculo de ICMS (icms-summary.service.ts intocado)
 *   - endpoints existentes de drafts/NFe
 *   - storage.ts / IStorage
 *
 * Política de erro:
 *   - chamador é responsável por traduzir o `false`/`true` em
 *     ForbiddenError("PERIODO_FECHADO") + log [SECURITY] PERIODO_FECHADO.
 *   - Mantemos o service puro/sem side-effect para ficar fácil de testar.
 */
import { db } from "../../database/db";
import { fiscalClosures } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

/**
 * Verifica se o mês de uma data já foi fechado para a empresa.
 *
 * Estratégia EXISTS (LIMIT 1) — não conta linhas, então tolera duplicidade
 * (consistente com a decisão "sem unique constraint nesta fase"). Datas
 * inválidas devolvem `false` (fail-open) para preservar 100% o comportamento
 * atual em caso de pedido sem `createdAt`.
 */
export async function isPeriodClosed(
  companyId: number,
  date: Date,
): Promise<boolean> {
  if (!Number.isInteger(companyId) || companyId <= 0) return false;
  if (!(date instanceof Date) || isNaN(date.getTime())) return false;

  const year = date.getFullYear();
  const month = date.getMonth() + 1; // JS month é 0-indexado; coluna usa 1-12

  const rows = await db
    .select({ one: sql<number>`1` })
    .from(fiscalClosures)
    .where(
      and(
        eq(fiscalClosures.companyId, companyId),
        eq(fiscalClosures.year, year),
        eq(fiscalClosures.month, month),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Fecha o mês para a empresa. Insere uma linha em `fiscal_closures`.
 *
 * NÃO valida duplicidade (spec — fase futura). Se o mês for fechado
 * duas vezes, simplesmente cria duas linhas; `isPeriodClosed` continua
 * funcionando porque o EXISTS aceita N linhas.
 */
export async function closePeriod(
  companyId: number,
  year: number,
  month: number,
): Promise<void> {
  await db.insert(fiscalClosures).values({
    companyId,
    year,
    month,
  });
}
