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
// FASE 6.2 — persistência de eventos (fail-open, não bloqueia o throw).
import { logTenantMismatchEvent } from "../../modules/security/security.repository";
// FASE 6.5 — bloqueio temporário (in-memory) para abusadores detectados.
import {
  isUserBlocked,
  blockedCount,
  hydrateBlockFromDb,
} from "../../modules/security/security.blocker";
// FASE 6.9 — fallback no DB para sobreviver a restarts do processo.
import { getActiveBlock } from "../../modules/security/security.block.repository";
import { getTenantContext } from "../tenant/context";

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
 * FASE 6.2 — Ponto único de emissão de logs de segurança.
 *
 * Centraliza todos os `console.error` de eventos [SECURITY] para que
 * futuras evoluções (ex.: envio para SIEM, persistência assíncrona,
 * rate-limiting de log-spam) sejam feitas em UM único lugar.
 *
 * NÃO altera o formato da mensagem — apenas encapsula o transporte.
 * NÃO captura exceções — falhas de log não devem silenciar erros de segurança.
 */
function logSecurity(message: string): void {
  console.error(message);
}

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
  logSecurity(
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

  // FASE 6.5 + 6.9 — bloqueio em duas camadas:
  //   1. Memória (rápido, primeira linha de defesa).
  //   2. DB (fallback pós-restart; só é consultado se memória diz "não").
  // Resolve email do principal uma única vez para reaproveitar nos dois
  // checks. Falha de lookup nunca pode quebrar o fluxo normal.
  let userEmail: string | null = null;
  try {
    const ctx = getTenantContext();
    const userId = ctx?.principal?.userId;
    if (typeof userId === "number" && userId > 0) {
      const user = (await storage.getUser(userId)) as
        | { email?: string | null }
        | undefined;
      userEmail = user?.email ?? null;
    }
  } catch {
    // lookup falhou; segue sem email — apenas as proteções legadas atuam.
  }

  // (1) Memória — preserva o early-exit quando o Map está vazio.
  if (
    blockedCount() > 0 &&
    userEmail &&
    isUserBlocked(userEmail)
  ) {
    throw new ForbiddenError("Too many invalid access attempts");
  }

  // (2) DB fallback (FASE 6.9) — só consulta se NÃO bloqueado em memória.
  // Re-hidrata a memória com o TTL ORIGINAL do DB para que próximas
  // chamadas batam apenas em memória até o bloqueio expirar.
  if (userEmail) {
    try {
      const dbBlock = await getActiveBlock(userEmail);
      if (dbBlock) {
        hydrateBlockFromDb(userEmail, dbBlock.blockedUntil.getTime());
        throw new ForbiddenError("Too many invalid access attempts");
      }
    } catch (err) {
      if (err instanceof ForbiddenError) throw err;
      // Falha de DB no fallback NÃO deve quebrar fluxo legítimo.
    }
  }

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
    // FASE 6.2 — persiste o evento (fail-open: nunca bloqueia o throw abaixo).
    // Sem acesso a `req` aqui: usa fallback "unknown" para path/method.
    await logTenantMismatchEvent({
      tenantId,
      orderId,
      path: "unknown",
      method: "unknown",
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

/**
 * FASE 6 — Padronização global de tenant guard para recursos de empresa.
 *
 * Valida que o `companyId` solicitado pertence ao tenant da sessão atual.
 * Centraliza o padrão manual que existia em rotas legacy:
 *
 *   if (req.session?.companyId && req.session.companyId !== id) { ... }
 *
 * Política:
 *   - sem `sessionCompanyId` (admin/global sem pinning) → passa livremente
 *   - `sessionCompanyId === companyId` → passa
 *   - `sessionCompanyId !== companyId` → lança ForbiddenError + log [SECURITY]
 *
 * O parâmetro `req` é opcional para compatibilidade com call-sites que já
 * possuem `req` disponível. Sem `req`, o log usa fallback "unknown" para
 * requestId — comportamento seguro idêntico ao do tenantGuard de orders.
 *
 * NÃO substitui `assertCompanyAccess` (repository) nem as validações de
 * order. Convive com ambos. Destinado exclusivamente a rotas legacy que
 * não passam por tenantContext middleware.
 */
export function validateCompanyTenant(companyId: number, req?: any): void {
  const sessionCompanyId: number | undefined = req?.session?.companyId;

  // Sem contexto de empresa pinado → admin/global, passa livremente.
  if (!sessionCompanyId) return;

  if (sessionCompanyId !== companyId) {
    logSecurity(
      `[SECURITY] TENANT_MISMATCH | requestId=${req?.requestId ?? "unknown"} | companyId=${companyId} | details=Tenant mismatch sessionCompanyId=${sessionCompanyId}`,
    );
    throw new ForbiddenError(
      `Acesso negado: empresa #${companyId} não pertence ao tenant atual.`,
    );
  }
}

/**
 * FASE 6.2 — Acesso seguro a pedido com validação de tenant integrada.
 *
 * Combina `validateOrderTenant` + `storage.getOrder` em uma única chamada
 * garantida, para uso futuro em rotas que precisam tanto validar o tenant
 * quanto obter os dados do pedido em seguida.
 *
 * Política de erro (mesma de validateOrderTenant + safeGetOrder):
 *   - tenant ausente / mismatch → ForbiddenError + log [SECURITY]
 *   - pedido não encontrado     → NotFoundError
 *
 * O parâmetro `req` é aceito para compatibilidade futura (ex.: quando
 * `validateOrderTenant` for atualizado para logar path/method via `req`).
 * Atualmente não é passado adiante — não altera o comportamento existente.
 *
 * NÃO substitui usages existentes. Destinado a novos call-sites.
 */
export async function safeGetOrderOrThrow(
  orderId: number,
  _req?: any,
): Promise<StoredOrder> {
  // FASE 6.2 — valida tenant (lança ForbiddenError em mismatch).
  await validateOrderTenant(orderId);

  // Relê após validação: mantém exatamente a fonte de dados de storage.getOrder
  // sem alterar o contrato de validateOrderTenant/safeGetOrder.
  const order = (await storage.getOrder(orderId)) as StoredOrder | undefined;
  if (!order) {
    throw new NotFoundError(`Pedido #${orderId} não encontrado`);
  }

  return order;
}

/**
 * FASE 6.2 — Acesso seguro a empresa com validação de tenant integrada.
 *
 * Combina `validateCompanyTenant` + `storage.getCompany` em uma única
 * chamada garantida, para uso futuro em rotas de empresa que precisam
 * tanto guardar o tenant quanto obter os dados da empresa.
 *
 * Política de erro:
 *   - tenant mismatch           → ForbiddenError + log [SECURITY]
 *   - empresa não encontrada    → NotFoundError
 *
 * NÃO substitui usages existentes. Destinado a novos call-sites.
 */
export async function safeGetCompanyOrThrow(
  companyId: number,
  req?: any,
): Promise<NonNullable<Awaited<ReturnType<typeof storage.getCompany>>>> {
  // FASE 6.2 — valida tenant (lança ForbiddenError em mismatch).
  validateCompanyTenant(companyId, req);

  const company = await storage.getCompany(companyId);
  if (!company) {
    throw new NotFoundError(`Empresa #${companyId} não encontrada`);
  }

  return company;
}
