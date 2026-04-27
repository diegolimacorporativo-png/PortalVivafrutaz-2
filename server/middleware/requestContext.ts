/**
 * FASE 12 — Bridge middleware: copia `req.requestId` para o
 * AsyncLocalStorage de `server/core/context/requestContext.ts`.
 *
 * Por que existe:
 *   `req.requestId` (gerado por `requestIdMiddleware`) é acessível em
 *   handlers Express e controllers que recebem `req`. Mas services,
 *   repositories e guards (ex.: `safeGetOrder` em `tenantGuard.ts`) NÃO
 *   recebem `req` — eles precisam ler o requestId via storage.
 *
 * Onde montar:
 *   No `app.ts`, IMEDIATAMENTE APÓS `requestIdMiddleware`. Esse é o
 *   único pré-requisito (precisa de `req.requestId` populado). Pode
 *   rodar antes ou depois do `requestLogger` — ambos funcionam.
 *
 * Garantias:
 *   - Não toca em `req`, `res`, headers ou body.
 *   - Não interfere com o tenantContext: roda APENAS o `next()` dentro
 *     do store próprio. O `tenantContext` será aninhado depois (no
 *     ingresso do router) e ambos coexistem por design do Node
 *     `async_hooks`.
 *   - Se `req.requestId` estiver ausente (cenário improvável — o
 *     middleware está tipado como non-optional), usa fallback
 *     `"unknown"` para preservar a invariante de que o store sempre
 *     tem um id quando dentro do escopo do request.
 */

import type { Request, Response, NextFunction } from "express";
import { runWithRequestContext } from "../core/context/requestContext";

export function requestContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const id =
    typeof req.requestId === "string" && req.requestId.length > 0
      ? req.requestId
      : "unknown";
  runWithRequestContext(id, () => next());
}
