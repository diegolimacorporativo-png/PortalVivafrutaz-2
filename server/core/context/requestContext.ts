/**
 * FASE 12 — Request correlation context (paralelo, isolado).
 *
 * Carrega o `requestId` da requisição atual via AsyncLocalStorage próprio,
 * INDEPENDENTE do tenantContext (`server/core/tenant/context.ts`). A
 * coexistência é segura por design: cada `AsyncLocalStorage` mantém seu
 * próprio mapeamento por contexto async (pattern oficial de
 * `node:async_hooks`). Stores aninhados — tenant.run(t, () => req.run(r,
 * () => next())) — propagam de forma totalmente independente em todos os
 * hops async (await, setTimeout, Promise.then, etc.).
 *
 * Decisão arquitetural:
 *   - NÃO estendemos `TenantContext`: a regra da fase proíbe alterar o
 *     tenantContext existente.
 *   - REUTILIZAMOS o `req.requestId` já gerado por
 *     `server/middleware/requestId.ts` (não geramos um id novo aqui).
 *     Isso garante que o id do AsyncLocalStorage é EXATAMENTE o mesmo que
 *     vai no header `X-Request-Id` e nos logs entry/exit do `requestLogger`.
 *
 * Política de leitura:
 *   - `getRequestId()` retorna `string | undefined`. Fora do escopo de uma
 *     requisição (workers, cron) o valor é `undefined` — o caller decide
 *     se exibe `unknown` ou omite o campo. NUNCA lança.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Roda `fn` dentro do escopo do request. O middleware HTTP é o único
 * caller esperado. Workers/cron NÃO devem chamar isto — manter o store
 * vazio fora do request é o comportamento correto.
 */
export function runWithRequestContext<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/**
 * Retorna o requestId atual ou `undefined` quando não há contexto. Não
 * lança — logs de segurança em workers/cron devem usar fallback.
 */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Helper de formatação para logs `[SECURITY]`. Padroniza o fallback
 * quando o requestId é desconhecido (workers, cron, código fora do
 * request). Garante o mesmo literal `unknown` em todos os call sites,
 * preservando a forma `requestId=<valor>` da FASE 12.
 */
export function getRequestIdForLog(): string {
  return getRequestId() ?? "unknown";
}
