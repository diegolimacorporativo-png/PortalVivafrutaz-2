/**
 * FASE 1 — Camada de proteção multi-tenant (NÃO INTEGRADA AINDA).
 *
 * Este arquivo é PARALELO ao código existente. Ele não substitui
 * `storage.getOrder`, não altera `buildNFeInput`, não toca em
 * `routes.ts` e não modifica nenhum endpoint atual. O objetivo é
 * disponibilizar duas funções utilitárias prontas para uso futuro,
 * quando os call-sites legados forem migrados de forma controlada.
 *
 * Funções expostas:
 *   - safeGetOrder(orderId)        → busca um pedido validando o tenant.
 *   - validateOrderTenant(orderId) → apenas valida o tenant (sem retornar dados).
 *
 * Ambas usam `requireTenantId()` (AsyncLocalStorage), exatamente como o
 * restante da camada de tenant em `server/core/tenant/scope.ts`. Se
 * não houver tenant ativo no contexto, `requireTenantId` lança — esse
 * comportamento é mantido aqui (fail-closed).
 *
 * Política de erro:
 *   - tenant ausente            → erro propagado por requireTenantId (UnauthorizedError)
 *   - pedido não encontrado     → NotFoundError
 *   - pedido de outro tenant    → ForbiddenError + log [SECURITY]
 *
 * Log de segurança padronizado:
 *   [SECURITY] TENANT_MISMATCH | requestId={requestId} | orderId={orderId} | details=Tenant mismatch tenant={tenantId} orderCompanyId={companyId}
 *
 * IMPORTANTE: este arquivo não é importado por nenhum outro módulo
 * neste momento. Ele existe apenas como camada de proteção pronta
 * para adoção incremental.
 */

import { storage } from "../../services/storage";
import { requireTenantId } from "../tenant/context";
import { getRequestIdForLog } from "../context/requestContext";
import {
  ForbiddenError,
  NotFoundError,
} from "../../shared/errors/AppError";

// ── Tipos auxiliares ─────────────────────────────────────────────────────────

/**
 * Shape mínimo que precisamos inspecionar de um pedido para validar
 * o tenant. Mantemos `unknown` no resto para não acoplar este guard
 * ao tipo concreto retornado por `storage.getOrder` (que pode evoluir).
 */
type OrderLike = {
  companyId?: number | null;
  empresaId?: number | null;
};

type StoredOrder = {
  order: OrderLike & Record<string, unknown>;
  items: unknown[];
};

// ── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Extrai o id do tenant a partir do pedido. Tabelas legadas podem usar
 * `companyId` (orders) ou `empresaId` (variantes) — aceitamos ambos
 * e priorizamos `companyId`, que é o campo real de `orders`.
 */
function extractOrderTenantId(order: OrderLike): number | null {
  const raw =
    order.companyId !== undefined && order.companyId !== null
      ? order.companyId
      : order.empresaId !== undefined && order.empresaId !== null
        ? order.empresaId
        : null;

  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Log padronizado de tentativa de acesso cruzado entre tenants. Mantido
 * em console.error para garantir visibilidade no stdout do container —
 * mesmo padrão usado pelos demais módulos críticos do servidor (ex.:
 * faturamento.cron, NFE_BLOCKED em routes.ts).
 */
function logSecurityMismatch(params: {
  orderId: number;
  tenantId: number;
  orderCompanyId: number | null;
}): void {
  const { orderId, tenantId, orderCompanyId } = params;
  console.error(
    `[SECURITY] TENANT_MISMATCH | requestId=${getRequestIdForLog()} | orderId=${orderId} | details=Tenant mismatch tenant=${tenantId} orderCompanyId=${orderCompanyId ?? "unknown"}`,
  );
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Busca um pedido pelo id e garante que ele pertence ao tenant atual.
 *
 * Fluxo:
 *   1. Resolve o tenant ativo via `requireTenantId()` (lança se ausente).
 *   2. Lê o pedido pelo `storage.getOrder` (mesma fonte que o caminho legado,
 *      portanto sem divergência de leitura).
 *   3. Compara `order.companyId` (ou `empresaId`) com o tenant ativo.
 *   4. Retorna `{ order, items }` quando casa; lança `ForbiddenError`
 *      e loga [SECURITY] quando não casa; lança `NotFoundError` quando
 *      o pedido não existe.
 *
 * NÃO substitui `storage.getOrder`. NÃO é chamada por ninguém ainda.
 */
export async function safeGetOrder(orderId: number): Promise<StoredOrder> {
  const tenantId = requireTenantId();

  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new NotFoundError(`Pedido inválido: ${orderId}`);
  }

  const result = (await storage.getOrder(orderId)) as StoredOrder | undefined;
  if (!result || !result.order) {
    throw new NotFoundError(`Pedido #${orderId} não encontrado.`);
  }

  const orderTenantId = extractOrderTenantId(result.order);
  if (orderTenantId !== tenantId) {
    logSecurityMismatch({
      orderId,
      tenantId,
      orderCompanyId: orderTenantId,
    });
    throw new ForbiddenError(
      `Acesso negado ao pedido #${orderId}: pertence a outro tenant.`,
    );
  }

  return result;
}

/**
 * Valida apenas que o pedido pertence ao tenant atual, sem expor o pedido
 * ao chamador. Útil como pré-condição antes de operações fiscais sensíveis
 * (ex.: emissão de NF, geração de DANFE) onde o caminho posterior já
 * relê o pedido por conta própria.
 *
 * Reaproveita `safeGetOrder` para manter UMA única política de validação
 * de tenant — qualquer mudança futura (ex.: tabelas com `tenantId` próprio)
 * é feita em um único lugar.
 */
export async function validateOrderTenant(orderId: number): Promise<void> {
  await safeGetOrder(orderId);
}
