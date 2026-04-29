/**
 * FASE 6.2 — Security Audit Repository (real persistence)
 *
 * Repositório de auditoria de segurança. Hoje cobre tentativas de acesso
 * cruzado entre tenants. Toda gravação é fail-open: se o INSERT falhar,
 * apenas logamos no stderr e seguimos — nunca propagamos a exceção para
 * o caller (que está, geralmente, no meio do throw de ForbiddenError).
 *
 * Política de PII / segurança:
 *  - getTenantMismatchEvents: retorna apenas agregados (sem dados sensíveis)
 *  - logTenantMismatchEvent : grava contexto interno (orderId/tenantId/email)
 *    porque a tabela é apenas leitura para MASTER via endpoint admin
 *
 * Funções:
 *   - logTenantMismatchEvent(data): grava 1 evento (fail-open)
 *   - getTenantMismatchEvents(days): agrega contagens por orderId no período
 */
import { db } from "../../database/db";
import { tenantMismatchEvents } from "@shared/schema";
import { sql } from "drizzle-orm";
// FASE 6.5 — bloqueio temporário em memória (safe-mode, sem banco).
import { blockUser } from "./security.blocker";

export interface LogTenantMismatchInput {
  tenantId?: number | null;
  orderId?: number | null;
  userId?: number | null;
  email?: string | null;
  path?: string | null;
  method?: string | null;
}

/**
 * Grava 1 evento de tenant mismatch. Fail-open: qualquer erro de INSERT
 * é capturado e logado, sem propagar para o caller.
 */
export async function logTenantMismatchEvent(
  data: LogTenantMismatchInput,
): Promise<void> {
  try {
    await db.insert(tenantMismatchEvents).values({
      tenantId: data.tenantId ?? null,
      orderId: data.orderId ?? null,
      userId: data.userId ?? null,
      email: data.email ?? null,
      path: data.path ?? null,
      method: data.method ?? null,
    });
  } catch (err: any) {
    console.error(
      `[SECURITY_AUDIT] Failed to persist TENANT_MISMATCH event: ${err?.message || err}`,
    );
  }
}

/**
 * Threshold de detecção de abuso (FASE 6.4). Acima disso, o usuário
 * entra na lista `suspiciousUsers` retornada pelo endpoint admin.
 * Mantido como constante exportada para reuso futuro (alertas/bloqueio).
 */
export const ABUSE_THRESHOLD = 5;

/**
 * Agrega tentativas de tenant mismatch no período `days` (default 7,
 * máximo 90). Retorna apenas contagens — nenhum dado sensível é exposto
 * além do orderId/email/path, todos necessários para correlação.
 *
 * FASE 6.3 — agrega por `email` (quem) e `path` (onde).
 * FASE 6.4 — acrescenta `topUsers` e `topPaths` (ranking) e
 *            `suspiciousUsers` (≥ ABUSE_THRESHOLD), sem remover
 *            nenhum campo anterior.
 */
export async function getTenantMismatchEvents(days: number): Promise<{
  total: number;
  byOrder: Record<string, number>;
  byUser: Record<string, number>;
  byPath: Record<string, number>;
  topUsers: Array<[string, number]>;
  topPaths: Array<[string, number]>;
  suspiciousUsers: Array<{ email: string; count: number }>;
  windowDays: number;
}> {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 7;
  const windowExpr = sql`${tenantMismatchEvents.createdAt} >= now() - (${safeDays}::int * interval '1 day')`;

  try {
    const [byOrderRows, byUserRows, byPathRows] = await Promise.all([
      db
        .select({
          orderId: tenantMismatchEvents.orderId,
          count: sql<number>`count(*)::int`,
        })
        .from(tenantMismatchEvents)
        .where(windowExpr)
        .groupBy(tenantMismatchEvents.orderId),
      db
        .select({
          email: tenantMismatchEvents.email,
          count: sql<number>`count(*)::int`,
        })
        .from(tenantMismatchEvents)
        .where(windowExpr)
        .groupBy(tenantMismatchEvents.email),
      db
        .select({
          path: tenantMismatchEvents.path,
          count: sql<number>`count(*)::int`,
        })
        .from(tenantMismatchEvents)
        .where(windowExpr)
        .groupBy(tenantMismatchEvents.path),
    ]);

    const byOrder: Record<string, number> = {};
    let total = 0;
    for (const row of byOrderRows) {
      const key = row.orderId === null ? "unknown" : String(row.orderId);
      const c = Number(row.count) || 0;
      byOrder[key] = c;
      total += c;
    }

    const byUser: Record<string, number> = {};
    for (const row of byUserRows) {
      byUser[row.email ?? "unknown"] = Number(row.count) || 0;
    }

    const byPath: Record<string, number> = {};
    for (const row of byPathRows) {
      byPath[row.path ?? "unknown"] = Number(row.count) || 0;
    }

    // FASE 6.4 — ranking + detecção de abuso (puro pós-processamento).
    const topUsers: Array<[string, number]> = Object.entries(byUser)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topPaths: Array<[string, number]> = Object.entries(byPath)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const suspiciousUsers = Object.entries(byUser)
      .filter(([, count]) => count >= ABUSE_THRESHOLD)
      .map(([email, count]) => ({ email, count }));

    // FASE 6.5 — aciona o bloqueio temporário (in-memory) para cada
    // usuário suspeito. Ignora a chave "unknown" (não há email real para
    // bloquear) e qualquer string vazia, evitando falsos positivos.
    for (const { email } of suspiciousUsers) {
      if (email && email !== "unknown") blockUser(email);
    }

    return {
      total,
      byOrder,
      byUser,
      byPath,
      topUsers,
      topPaths,
      suspiciousUsers,
      windowDays: safeDays,
    };
  } catch (err: any) {
    console.error(
      `[SECURITY_AUDIT] Failed to aggregate TENANT_MISMATCH events: ${err?.message || err}`,
    );
    return {
      total: 0,
      byOrder: {},
      byUser: {},
      byPath: {},
      topUsers: [],
      topPaths: [],
      suspiciousUsers: [],
      windowDays: safeDays,
    };
  }
}
