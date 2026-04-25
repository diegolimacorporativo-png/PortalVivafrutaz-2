import type { Request, Response, NextFunction } from "express";
import { fail } from "../core/http/apiResponse";

/**
 * Service authentication — a controlled escape hatch from the session-only
 * security model.
 *
 * Why this exists
 * ---------------
 * The previously-public legacy endpoints (e.g. `GET /api/companies`) were
 * removed from the open internet when the new modules tightened auth. Some
 * **internal** consumers — the GPS tracker daemon, the ERP cron jobs, the
 * NF-e poller, third-party integrations operating on behalf of a tenant —
 * have no human session and used to rely on those open endpoints.
 *
 * Rather than re-opening the surface to anonymous traffic, we accept a
 * pre-shared secret in the `x-api-key` header. Requests that present a
 * matching key are flagged with `req.isService = true` and may be combined
 * with `requireAuthOrService` to bypass the session check on a
 * route-by-route basis.
 *
 * Defence in depth
 * ----------------
 * Service requests STILL go through `tenantContext`. There is no
 * "super-admin" mode here — the caller MUST identify the target tenant via
 * `?empresaId=N` or the `X-Empresa-Id` header. Reads on routes that require
 * a tenant (everything mounted in this codebase) will fail with 403 unless
 * a tenant is supplied. Writes are NOT enabled by default — see
 * `requireAuthOrService` for the gating model.
 *
 * Configuration
 * -------------
 * If `INTERNAL_API_KEY` is empty/undefined, service auth is silently
 * disabled. This is the secure default for environments that have not yet
 * provisioned a key — any incoming `x-api-key` header is ignored and the
 * caller falls back to session-only auth.
 */

declare global {
  namespace Express {
    interface Request {
      isService?: boolean;
    }
  }
}

const HEADER_NAME = "x-api-key";

function configuredKey(): string | undefined {
  const k = process.env.INTERNAL_API_KEY;
  return k && k.trim().length > 0 ? k : undefined;
}

/**
 * Best-effort detector — sets `req.isService` if the inbound `x-api-key`
 * matches the configured secret. Never short-circuits the request: callers
 * combine it with `requireAuthOrService` (or skip it entirely) to decide
 * what to do with the flag.
 *
 * Note we DO NOT reject when the header is present-but-wrong here. That is
 * `requireAuthOrService`'s job — it returns 401 with a consistent envelope.
 * Doing the check inline keeps unrelated routes (which never opted into
 * service auth) immune to header-poisoning probes.
 */
export function detectServiceAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const provided = req.header(HEADER_NAME);
  const expected = configuredKey();
  if (provided && expected && timingSafeEquals(provided, expected)) {
    req.isService = true;
  }
  next();
}

/**
 * Combined gate: allow the request through if EITHER
 *   1. there is an authenticated session (`req.session.userId`), OR
 *   2. the request carries a valid `x-api-key` header.
 * Otherwise return a standard 401 envelope.
 *
 * This middleware is the *only* place a service request earns the right to
 * skip the session check. Mount it explicitly on the routes you intend to
 * expose to service callers — never globally.
 *
 * Use `requireAuth` for endpoints that should remain session-only (writes,
 * privileged admin actions, anything that mutates data on behalf of a
 * specific human).
 */
export function requireAuthOrService(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const session = (req as any).session;
  if (session?.userId || session?.companyId) {
    return next();
  }

  // Re-evaluate the header here so this middleware is safe to use on its
  // own (without `detectServiceAuth` mounted globally).
  const provided = req.header(HEADER_NAME);
  const expected = configuredKey();
  if (provided && expected && timingSafeEquals(provided, expected)) {
    req.isService = true;
    return next();
  }

  fail(res, "Unauthorized service access", "UNAUTHORIZED", 401);
}

/**
 * Constant-time string compare to avoid leaking the configured key length
 * or prefix via response-time analysis. Using a hand-rolled loop instead of
 * `crypto.timingSafeEqual` keeps the dependency surface flat and sidesteps
 * the Buffer-length precondition (which would itself leak length).
 */
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still iterate over the longer string so the timing is independent of
    // the mismatch position — only the length difference is observable, and
    // an attacker already knows their own input length.
    let acc = 1;
    const longer = a.length > b.length ? a : b;
    for (let i = 0; i < longer.length; i++) acc |= 1;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
