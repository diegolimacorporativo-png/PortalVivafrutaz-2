/**
 * FASE 20 — Proteção contra concorrência na emissão de NF-e (GAP 1 e GAP 7).
 *
 * Garante que apenas UMA emissão ocorra por (tenantId, orderId) ao mesmo
 * tempo, usando PostgreSQL advisory locks com a forma de 2 inteiros:
 *
 *     pg_try_advisory_lock(tenantId, orderId)
 *
 * Por que (tenantId, orderId)?
 *   - Multi-tenant seguro: o mesmo orderId em tenants diferentes é
 *     independente. Sem colisão. Sem hash.
 *   - Granular: dois pedidos diferentes do mesmo tenant não bloqueiam
 *     um ao outro.
 *
 * NOTA TÉCNICA SOBRE POOL DE CONEXÕES:
 *   Este projeto usa pg.Pool com Drizzle. Advisory locks da forma
 *   `pg_try_advisory_lock` são SESSION-SCOPED — presos à conexão.
 *   Sob pool, cada `db.execute()` pode pegar uma conexão diferente,
 *   o que tornaria `acquire` em uma chamada e `release` em outra
 *   inseguro (o release rodaria em uma sessão que NÃO detém o lock).
 *
 *   Por isso, este módulo:
 *     1. Reserva um client dedicado do pool no acquire,
 *     2. Mantém o client preso ao "handle" retornado,
 *     3. Faz o release na MESMA conexão e devolve o client ao pool.
 *
 *   Funcionalmente equivale ao padrão clássico boolean+try/finally;
 *   apenas o tipo de retorno muda para um handle opaco.
 *
 * Escopo: resolve concorrência (GAP 1, GAP 7). NÃO substitui a regra
 * de idempotência sequencial da FASE 18 — atua em camada anterior,
 * complementar.
 *
 * Comportamento se já houver lock:
 *   - acquireOrderLock retorna `null` imediatamente (NÃO espera, NÃO
 *     faz retry).
 *   - O chamador decide o que reportar (HTTP 409 / status "skipped_lock").
 */

import type { PoolClient } from "pg";
import { pool } from "../../database/db";

export type OrderLockHandle = {
  tenantId: number;
  orderId: number;
  /**
   * Cliente dedicado do pool — mantido até o release. NÃO usar
   * diretamente fora deste módulo.
   */
  _client: PoolClient;
};

/**
 * Tenta adquirir um lock exclusivo para (tenantId, orderId).
 *
 * @returns handle opaco se adquirido; `null` se já estiver em uso.
 *          Em caso de erro inesperado do banco, propaga a exceção
 *          (e devolve o client ao pool).
 */
export async function acquireOrderLock(
  tenantId: number,
  orderId: number,
): Promise<OrderLockHandle | null> {
  if (!Number.isInteger(tenantId) || !Number.isInteger(orderId)) {
    throw new Error(
      `acquireOrderLock: tenantId e orderId devem ser inteiros (recebido tenantId=${tenantId}, orderId=${orderId})`,
    );
  }

  const client = await pool.connect();
  try {
    const r = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [tenantId, orderId],
    );
    const acquired = r.rows[0]?.acquired === true;
    if (!acquired) {
      client.release();
      return null;
    }
    return { tenantId, orderId, _client: client };
  } catch (err) {
    client.release();
    throw err;
  }
}

/**
 * Libera o lock e devolve a conexão ao pool. Idempotente: chamar duas
 * vezes no mesmo handle é seguro (nunca derruba o fluxo do chamador).
 */
export async function releaseOrderLock(
  handle: OrderLockHandle,
): Promise<void> {
  try {
    await handle._client.query(
      "SELECT pg_advisory_unlock($1, $2) AS released",
      [handle.tenantId, handle.orderId],
    );
  } catch (err) {
    // Não relançar — release nunca deve quebrar o caller. Loga e segue.
    console.error(
      `[NFE_CONCURRENCY_LOCK_RELEASE_ERROR] tenantId=${handle.tenantId} | orderId=${handle.orderId} | error=${(err as any)?.message ?? err}`,
    );
  } finally {
    try {
      handle._client.release();
    } catch {
      // já liberado — ignora
    }
  }
}
