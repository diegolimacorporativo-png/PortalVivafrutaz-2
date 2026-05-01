/**
 * FASE 7 — Rate limiting + high-risk action logging (in-memory, no DB).
 *
 * Architecture decision: purely additive layer — no existing middleware,
 * route handler, auth guard, or tenant guard is modified. Every export here
 * is an independent Express middleware that can be mounted selectively.
 *
 * Design:
 *   • createRateLimiter() — generic factory; each call returns an isolated
 *     Map<ip, Window> so rate windows never bleed across limiter instances.
 *   • Stale-entry cleanup via setInterval(..).unref() — the timer won't
 *     prevent process exit and runs every 5 minutes.
 *   • IP resolution: X-Forwarded-For (first hop) → socket.remoteAddress.
 *
 * Exported limiters:
 *   apiLimiter      — 60 req / 1 min  (orders, import — general API calls)
 *   loginIpLimiter  —  5 req / 5 min  (login endpoint — brute-force guard)
 *   nfeLimiter      — 30 req / 1 min  (NF-e fiscal routes)
 *   adminLimiter    — 40 req / 1 min  (admin routes)
 *
 * Exported loggers (log-only, never block):
 *   highRiskActionLogger — [SECURITY] HIGH_RISK_ACTION on POST/DELETE
 *   criticalActionLogger — [SECURITY] CRITICAL_ACTION on emission/cancellation/delete
 */

import type { Request, Response, NextFunction } from "express";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"] as string | undefined;
  const first = (forwarded ?? "").split(",")[0].trim();
  return first || req.socket?.remoteAddress || "unknown";
}

function getRequestId(req: Request): string {
  return (req as any).requestId ?? "unknown";
}

// ── Core factory ──────────────────────────────────────────────────────────────

interface RateWindow {
  count: number;
  resetAt: number;
}

function createRateLimiter(
  maxRequests: number,
  windowMs: number,
  message: string,
) {
  const store = new Map<string, RateWindow>();

  // Prune expired entries every 5 minutes so the Map stays bounded.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, win] of store) {
      if (now > win.resetAt) store.delete(key);
    }
  }, 5 * 60_000);

  // .unref() prevents this timer from keeping the process alive during tests
  // or graceful shutdown — same pattern as memorystore's pruning timer.
  if (timer.unref) timer.unref();

  return function rateLimiter(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const ip = getClientIp(req);
    const now = Date.now();

    let win = store.get(ip);

    if (!win || now > win.resetAt) {
      // First request in this window — initialise and pass through.
      store.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    win.count += 1;

    if (win.count > maxRequests) {
      const retryAfter = Math.ceil((win.resetAt - now) / 1000);
      console.warn(
        `[SECURITY] RATE_LIMITED | ip=${ip} | path=${req.path} | requestId=${getRequestId(req)}`,
      );
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ message });
      return;
    }

    next();
  };
}

// ── Pre-configured limiters ───────────────────────────────────────────────────

/** General API limiter — applied to /api/orders and /api/import. */
export const apiLimiter = createRateLimiter(
  60,
  60_000,
  "Muitas requisições. Tente novamente em breve.",
);

/**
 * Login IP limiter — 5 attempts per IP per 5-minute window.
 *
 * Complements the per-account lockout already in AuthService (MAX_ATTEMPTS=3):
 * that one locks the account record; this one blocks the IP entirely,
 * protecting even accounts that don't exist yet.
 */
export const loginIpLimiter = createRateLimiter(
  5,
  5 * 60_000,
  "Muitas tentativas de login. Aguarde 5 minutos e tente novamente.",
);

/** NF-e limiter — fiscal routes are expensive; tighter window. */
export const nfeLimiter = createRateLimiter(
  30,
  60_000,
  "Muitas requisições fiscais. Tente novamente em breve.",
);

/** Admin limiter — admin panel routes. */
export const adminLimiter = createRateLimiter(
  40,
  60_000,
  "Muitas requisições administrativas. Tente novamente em breve.",
);

// ── High-risk action detector (ETAPA 4) ──────────────────────────────────────

/**
 * Logs [SECURITY] HIGH_RISK_ACTION for every POST or DELETE received on the
 * mounted path. Log-only — never blocks or alters the response.
 *
 * Mount BEFORE the route handlers so the log is emitted even if a downstream
 * middleware short-circuits (e.g. auth guard returning 401).
 */
export function highRiskActionLogger(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.method === "POST" || req.method === "DELETE") {
    console.error(
      `[SECURITY] HIGH_RISK_ACTION | method=${req.method} | path=${req.path} | ip=${getClientIp(req)} | requestId=${getRequestId(req)}`,
    );
  }
  next();
}

// ── Critical action logger (ETAPA 5) ─────────────────────────────────────────

/**
 * Patterns that constitute a CRITICAL_ACTION on the /api/nfe and /api/admin
 * mount points. Matched against `req.path` (relative to the mount prefix).
 */
const CRITICAL_NFE_PATTERNS: Array<{ method: string; test: RegExp }> = [
  { method: "POST",   test: /^\/emitir($|\/)/ },
  { method: "POST",   test: /^\/emitir-lote($|\/)/ },
  { method: "POST",   test: /\/reenviar($|\/)/ },
  { method: "POST",   test: /\/corrigir-reenviar($|\/)/ },
  { method: "POST",   test: /\/enviar($|\/)/ },
  { method: "POST",   test: /^\/cron\/run($|\/)/ },
  { method: "DELETE", test: /.*/ }, // any DELETE on NF-e is a cancellation
];

const CRITICAL_ADMIN_PATTERNS: Array<{ method: string; test: RegExp }> = [
  { method: "DELETE", test: /.*/ },
  { method: "POST",   test: /\/(unlock|unblock|reset|sync|clean)/ },
];

/**
 * Logs [SECURITY] CRITICAL_ACTION for known high-impact NF-e and admin
 * operations. Mount this on both /api/nfe and /api/admin paths.
 *
 * Log-only — never modifies the response or blocks the request.
 */
export function criticalActionLogger(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const { method, path } = req;

  // Check NF-e critical patterns
  const isNfeCritical = CRITICAL_NFE_PATTERNS.some(
    (p) => p.method === method && p.test.test(path),
  );

  // Check admin critical patterns
  const isAdminCritical = CRITICAL_ADMIN_PATTERNS.some(
    (p) => p.method === method && p.test.test(path),
  );

  if (isNfeCritical || isAdminCritical) {
    const session = (req as any).session ?? {};
    const actor =
      session.userId
        ? `userId=${session.userId}`
        : session.companyId
          ? `companyId=${session.companyId}`
          : "unauthenticated";

    console.error(
      `[SECURITY] CRITICAL_ACTION | method=${method} | path=${path} | ip=${getClientIp(req)} | ${actor} | requestId=${getRequestId(req)}`,
    );
  }

  next();
}
