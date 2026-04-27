/**
 * FASE 6.5 — Wrapper reutilizável de proteção multi-tenant.
 *
 * Encapsula o boilerplate adicionado nas rotas durante a FASE 6:
 *
 *   try {
 *     await validateOrderTenant(Number(req.params.id));
 *   } catch (e) {
 *     if (e instanceof AppError) return res.status(e.status).json({ message: e.message });
 *     return next(e);
 *   }
 *   return controller(req, res, next);
 *
 * O objetivo é eliminar repetição (e o risco de esquecer o try/catch em
 * algum endpoint novo) sem alterar o comportamento já validado pelos
 * testes da FASE 6.1 (`tests/unit/tenantGuard.test.ts`).
 *
 * REGRAS ARQUITETURAIS:
 *   - NÃO substitui `validateOrderTenant` — apenas o invoca.
 *   - NÃO altera `safeGetOrder`, `storage`, nem o middleware de tenant.
 *   - NÃO modifica fluxos existentes — adoção é feita rota a rota,
 *     manualmente, em endpoints onde já existia (ou faria sentido) um
 *     guard de leitura cruzada.
 *
 * Política de extração do orderId:
 *   1. `req.params.id`        — usado em rotas `/api/orders/:id/...`
 *   2. `req.params.orderId`   — usado em rotas `/api/nfe/.../:orderId`
 *   3. nada                   — handler é chamado sem guard
 *      (mantém compat: rotas sem orderId podem usar o wrapper sem efeito).
 *
 * Política de erro: idêntica à dos endpoints já protegidos em FASE 6.
 *   - AppError → res.status(err.status).json({ message: err.message })
 *   - outros   → repassados a `next(e)` para o errorHandler global.
 *
 * Política de log: o log [SECURITY] TENANT_MISMATCH continua vindo de
 * `tenantGuard.ts` — não duplicamos aqui. O `console.debug` opcional
 * (ETAPA 4) só é emitido quando a env var `TENANT_GUARD_DEBUG=1` está
 * setada, evitando poluir stdout em produção.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { AppError } from "../shared/errors/AppError";
import { validateOrderTenant } from "../core/security/tenantGuard";

/**
 * Extrai o orderId da requisição. Retorna `null` quando não há nenhum
 * candidato válido (rota sem `:id`/`:orderId`, ou valores não numéricos).
 *
 * Note: `Number("") === 0` e `0` é considerado inválido por
 * `validateOrderTenant`, então normalizamos para `null` aqui para evitar
 * uma chamada desnecessária ao guard que sempre lançaria NotFoundError.
 */
function extractOrderId(req: Request): number | null {
  const raw =
    (req.params as any)?.id ??
    (req.params as any)?.orderId ??
    null;

  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Envolve um handler Express adicionando validação de tenant **antes**
 * da execução. O handler interno é chamado apenas se o guard passar.
 *
 * Tipo do handler: aceita o shape padrão `(req, res, next)`. O retorno
 * é encaminhado tal como está (Promise ou valor síncrono) — preservando
 * `await`/`.catch(next)` que o handler interno já faça.
 *
 * Exemplo:
 *   app.get(
 *     '/api/orders/:id/danfe-logs',
 *     withTenantGuard((req, res, next) => ordersController.listDanfeLogs(req, res).catch(next)),
 *   );
 */
export function withTenantGuard(
  handler: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>,
): RequestHandler {
  return async (req, res, next) => {
    const orderId = extractOrderId(req);

    if (process.env.TENANT_GUARD_DEBUG === "1") {
      console.debug("[TENANT_GUARD_WRAPPER]", { path: req.path, orderId });
    }

    if (orderId !== null) {
      try {
        await validateOrderTenant(orderId);
      } catch (e: any) {
        if (e instanceof AppError) {
          return res.status(e.status).json({ message: e.message });
        }
        return next(e);
      }
    }

    try {
      return await handler(req, res, next);
    } catch (e) {
      return next(e);
    }
  };
}
