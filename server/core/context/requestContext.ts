/**
 * FASE 2 — Request correlation context (expanded).
 *
 * Stores requestId + operational fields in a dedicated AsyncLocalStorage.
 * Fully independent of tenantContext — both coexist safely via Node's
 * async_hooks per-context propagation.
 *
 * Mutable object pattern: `storage.run` stores an object reference.
 * `enrichRequestContext()` mutates fields on that same object after
 * auth/session resolves — no need to re-enter the ALS scope.
 *
 * Fields populated at request entry (requestContextMiddleware):
 *   requestId, ip, userAgent, startTime
 *
 * Fields populated after session middleware (enrichment middleware in app.ts):
 *   actorId, role, tenantId
 *
 * Workers/cron have no context — all getters return undefined gracefully.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
  ip: string;
  userAgent: string;
  startTime: number;
  actorId?: number;
  role?: string;
  tenantId?: number | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Start a request context. Called only by the HTTP middleware.
 * Workers/cron must NOT call this — an empty store is the correct state
 * for non-request code.
 */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Enrich the current context with actor/tenant fields once session resolves.
 * Safe no-op when called outside a request scope.
 */
export function enrichRequestContext(
  fields: Partial<Pick<RequestContext, "actorId" | "role" | "tenantId">>,
): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  if (fields.actorId !== undefined) ctx.actorId = fields.actorId;
  if (fields.role !== undefined) ctx.role = fields.role;
  if (fields.tenantId !== undefined) ctx.tenantId = fields.tenantId;
}

/**
 * Return the full context or undefined outside a request scope.
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Return the requestId or undefined outside a request scope. Never throws.
 */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Formatted requestId for log lines. Returns "unknown" outside request scope.
 */
export function getRequestIdForLog(): string {
  return storage.getStore()?.requestId ?? "unknown";
}
