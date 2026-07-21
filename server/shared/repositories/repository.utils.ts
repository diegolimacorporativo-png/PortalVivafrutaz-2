/**
 * Utilitários compartilhados para repositórios — Wave 1B.
 *
 * Helpers aprovados no REPOSITORY_STANDARD.md (§4) para uso em todos os
 * repositórios criados ou refatorados a partir da Wave 1B.
 */

/**
 * Garante que uma operação de INSERT ou UPDATE com `.returning()` retornou
 * exatamente um registro. Lança erro descritivo em vez de retornar `undefined`
 * silenciosamente (substitui o padrão `rows[0]!` com non-null assertion).
 *
 * @param rows   Array retornado pelo Drizzle após `.returning()`.
 * @param context Nome do método/operação — aparece na mensagem de erro.
 *
 * @example
 * const rows = await db.insert(companies).values(data).returning();
 * return expectOne(rows, 'CompaniesRepository.create');
 */
export function expectOne<T>(rows: T[], context: string): T {
  if (rows.length === 0) {
    throw new Error(
      `[expectOne] Nenhum registro retornado em "${context}". ` +
        "A operação não encontrou a linha alvo ou a inserção falhou silenciosamente.",
    );
  }
  return rows[0];
}
