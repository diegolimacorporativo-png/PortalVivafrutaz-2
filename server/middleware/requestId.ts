import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

/**
 * Request-ID middleware.
 *
 * Goals:
 *   1. Every incoming request gets a unique correlation id at `req.requestId`
 *      so controllers, services and the central error handler can stamp it
 *      onto their log lines and you can grep a single request across
 *      modules.
 *   2. The same id is echoed back to the caller in the `X-Request-Id`
 *      response header so clients (browser, mobile app, integrations) can
 *      include it in bug reports.
 *   3. Honors an inbound `X-Request-Id` header when the caller already
 *      generated one (typical pattern for upstream proxies / API gateways)
 *      so the same id flows through the whole call chain.
 *
 * Notes:
 *   - `req.requestId` is typed as a NON-optional `string` so log call sites
 *     can interpolate it without a `?`/fallback dance.
 *   - We never throw here — the middleware is best-effort by design.
 */

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

const HEADER_NAME = "X-Request-Id";
const INCOMING_HEADER = "x-request-id";

/**
 * Best-effort sanitiser for an inbound `X-Request-Id`. We accept the value
 * only when it is a printable, reasonably-sized ASCII token to avoid header
 * injection or log-pollution attacks. Anything else falls back to a fresh
 * UUID — the contract that `req.requestId` is always a non-empty string is
 * preserved.
 */
function sanitizeIncomingId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 128) return null;
  // Printable ASCII, no whitespace, no control chars.
  if (!/^[A-Za-z0-9._:\-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = sanitizeIncomingId(req.headers[INCOMING_HEADER]);
  const id = incoming || randomUUID();
  req.requestId = id;
  res.setHeader(HEADER_NAME, id);
  next();
}
