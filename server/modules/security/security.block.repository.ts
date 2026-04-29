/**
 * FASE 6.9 — Repositório de bloqueios persistentes (DB).
 *
 * Camada de DURABILIDADE para o blocker in-memory (`security.blocker.ts`).
 * O bloqueio principal continua sendo o Map em memória; este módulo
 * apenas espelha esses bloqueios em uma tabela para sobreviverem a
 * restarts e permitirem auditoria.
 *
 * Garantias:
 *   - chave por email (lowercased) — alinhado com o blocker em memória
 *   - todas as operações são fail-safe (capturam erros e logam)
 *   - leitura ignora linhas expiradas (`blocked_until <= now()`)
 *   - nunca lança em condições normais; só propaga erro de programação
 *
 * NÃO substitui o blocker in-memory. NÃO é chamado por `validateOrderTenant`.
 * Wirings:
 *   - `blockUser`        → `persistBlock` (fire-and-forget)
 *   - `unblockUser`      → `removeActiveBlock` (fire-and-forget)
 *   - `safeGetOrder`     → `getActiveBlock` (fallback pós-restart)
 */

import { and, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "../../database/db";
import { securityBlockedUsers } from "@shared/schema";

function normalize(email?: string | null): string | null {
  if (!email || typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Persiste um bloqueio no DB. Inserção pura — múltiplas linhas para o
 * mesmo email são aceitas e tratadas como histórico; a leitura sempre
 * retorna apenas o bloqueio mais recente ainda ativo.
 *
 * Fail-safe: erros de DB são logados em stderr mas NÃO propagados.
 */
export async function persistBlock(
  email: string,
  blockedUntil: Date,
  reason: string = "tenant_mismatch_abuse",
): Promise<void> {
  const key = normalize(email);
  if (!key) return;
  try {
    await db.insert(securityBlockedUsers).values({
      email: key,
      blockedUntil,
      reason,
    });
  } catch (e) {
    console.error("[SECURITY_PERSIST_BLOCK_FAIL]", { email: key, error: (e as Error).message });
  }
}

/**
 * Retorna o bloqueio ativo mais recente para o email, ou `null` se
 * nenhum bloqueio ativo existir. "Ativo" = `blocked_until > now()`.
 */
export async function getActiveBlock(
  email?: string | null,
): Promise<{ email: string; blockedUntil: Date; reason: string | null } | null> {
  const key = normalize(email);
  if (!key) return null;
  try {
    const rows = await db
      .select({
        email: securityBlockedUsers.email,
        blockedUntil: securityBlockedUsers.blockedUntil,
        reason: securityBlockedUsers.reason,
      })
      .from(securityBlockedUsers)
      .where(
        and(
          eq(securityBlockedUsers.email, key),
          gt(securityBlockedUsers.blockedUntil, new Date()),
        ),
      )
      .orderBy(sql`${securityBlockedUsers.blockedUntil} DESC`)
      .limit(1);
    return rows[0] ?? null;
  } catch (e) {
    console.error("[SECURITY_DB_BLOCK_LOOKUP_FAIL]", { email: key, error: (e as Error).message });
    return null;
  }
}

/**
 * Atalho boolean para callers que só precisam saber "está bloqueado?".
 * Mesma fail-safety de `getActiveBlock`.
 */
export async function isBlockedInDB(email?: string | null): Promise<boolean> {
  return (await getActiveBlock(email)) !== null;
}

/**
 * Remove TODOS os bloqueios ativos do email. Usado pelo unblock manual
 * (FASE 6.8) para garantir que o usuário não volte a ser bloqueado por
 * um registro antigo no DB. Linhas expiradas ficam para auditoria.
 *
 * Fail-safe: erros de DB são logados mas não propagados.
 */
export async function removeActiveBlock(email?: string | null): Promise<number> {
  const key = normalize(email);
  if (!key) return 0;
  try {
    const result = await db
      .delete(securityBlockedUsers)
      .where(
        and(
          eq(securityBlockedUsers.email, key),
          gt(securityBlockedUsers.blockedUntil, new Date()),
        ),
      );
    return (result as any)?.rowCount ?? 0;
  } catch (e) {
    console.error("[SECURITY_DB_UNBLOCK_FAIL]", { email: key, error: (e as Error).message });
    return 0;
  }
}

/**
 * Test-only helper: limpa toda a tabela. Não usar em produção.
 */
export async function _resetBlockTableForTests(): Promise<void> {
  await db.delete(securityBlockedUsers);
}

/**
 * Helper de manutenção: remove linhas expiradas. Não é chamado
 * automaticamente; pode ser invocado por um cron futuro se quisermos
 * controlar o crescimento da tabela.
 */
export async function purgeExpiredBlocks(): Promise<number> {
  try {
    const result = await db
      .delete(securityBlockedUsers)
      .where(lte(securityBlockedUsers.blockedUntil, new Date()));
    return (result as any)?.rowCount ?? 0;
  } catch (e) {
    console.error("[SECURITY_DB_PURGE_FAIL]", (e as Error).message);
    return 0;
  }
}
