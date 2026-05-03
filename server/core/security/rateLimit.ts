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
// FASE 7.1 — feed all security events into the centralised observer.
// FASE 6.5 — logSecurity replaces scattered console.warn/error calls.
import { logSecurityEvent, logSecurity } from "./securityLogger";
// IP limiter config centralised in rateSchedule.ts — single source of truth.
import { IP_LOGIN_RATE_LIMIT } from "../auth/rateSchedule";

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
      const rid = getRequestId(req);
      logSecurity(
        `[SECURITY] RATE_LIMITED | ip=${ip} | path=${req.path} | requestId=${rid}`,
      );
      logSecurityEvent({ type: "RATE_LIMITED", ip, path: req.originalUrl, requestId: rid });
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
 * Login IP limiter — config driven from rateSchedule.IP_LOGIN_RATE_LIMIT.
 *
 * Complements the per-account lockout in AuthService (MAX_ATTEMPTS=3):
 * that one locks the account record; this one blocks the IP entirely,
 * protecting even accounts that don't exist yet. Threshold values live in
 * rateSchedule.ts so they can be tuned in one place for all limiters.
 */
export const loginIpLimiter = createRateLimiter(
  IP_LOGIN_RATE_LIMIT.maxRequests,
  IP_LOGIN_RATE_LIMIT.windowMs,
  `Muitas tentativas de login. Aguarde ${IP_LOGIN_RATE_LIMIT.windowMs / 60_000} minutos e tente novamente.`,
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

/**
 * Public limiter — unauthenticated public endpoints (e.g. /api/health).
 * 60 req/min per IP to prevent external ping-flood abuse.
 */
export const publicLimiter = createRateLimiter(
  60,
  60_000,
  "Muitas requisições. Tente novamente em breve.",
);

/**
 * Search limiter — authenticated but expensive (7 SQL queries per call).
 * 60 req/min per IP; authenticated users are not blanket-bypassed here.
 */
export const searchLimiter = createRateLimiter(
  60,
  60_000,
  "Muitas requisições de busca. Tente novamente em breve.",
);

/**
 * Sensitive action limiter — destructive / high-impact write operations:
 *   POST /api/import/execute  — bulk DB writes
 *   POST /api/nfe/cron/run    — fiscal cron trigger
 * 10 req/min per IP; intentionally tighter than apiLimiter / nfeLimiter.
 */
export const sensitiveActionLimiter = createRateLimiter(
  10,
  60_000,
  "Muitas requisições sensíveis. Aguarde antes de tentar novamente.",
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
    const ip = getClientIp(req);
    const rid = getRequestId(req);
    logSecurity(
      `[SECURITY] HIGH_RISK_ACTION | method=${req.method} | path=${req.path} | ip=${ip} | requestId=${rid}`,
    );
    const session = (req as any).session ?? {};
    logSecurityEvent({
      type: "HIGH_RISK_ACTION",
      ip,
      path: req.originalUrl,
      requestId: rid,
      userId: session.userId ?? undefined,
    });
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
    const ip = getClientIp(req);
    const rid = getRequestId(req);
    const actor =
      session.userId
        ? `userId=${session.userId}`
        : session.companyId
          ? `companyId=${session.companyId}`
          : "unauthenticated";

    logSecurity(
      `[SECURITY] CRITICAL_ACTION | method=${method} | path=${path} | ip=${ip} | ${actor} | requestId=${rid}`,
    );
    logSecurityEvent({
      type: "CRITICAL_ACTION",
      ip,
      path: req.originalUrl,
      requestId: rid,
      userId: session.userId ?? undefined,
    });
  }

  next();
}
