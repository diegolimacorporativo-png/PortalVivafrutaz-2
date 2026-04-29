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
 * Agrega tentativas de tenant mismatch no período `days` (default 7,
 * máximo 90). Retorna apenas contagens — nenhum dado sensível é exposto
 * além do orderId, que já é necessário para correlação.
 */
export async function getTenantMismatchEvents(days: number): Promise<{
  total: number;
  byOrder: Record<string, number>;
  windowDays: number;
}> {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 7;

  try {
    const rows = await db
      .select({
        orderId: tenantMismatchEvents.orderId,
        count: sql<number>`count(*)::int`,
      })
      .from(tenantMismatchEvents)
      .where(
        sql`${tenantMismatchEvents.createdAt} >= now() - (${safeDays}::int * interval '1 day')`,
      )
      .groupBy(tenantMismatchEvents.orderId);

    const byOrder: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const key = row.orderId === null ? "unknown" : String(row.orderId);
      const c = Number(row.count) || 0;
      byOrder[key] = c;
      total += c;
    }

    return { total, byOrder, windowDays: safeDays };
  } catch (err: any) {
    console.error(
      `[SECURITY_AUDIT] Failed to aggregate TENANT_MISMATCH events: ${err?.message || err}`,
    );
    return { total: 0, byOrder: {}, windowDays: safeDays };
  }
}
