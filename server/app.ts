import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "http";
import path from "path";
import fs from "fs";
import { registerModules, registerV1Modules, registerV2Modules } from "./modules";
import { registerRoutes } from "./routes/routes";
import { errorHandler } from "./core/errors/errorHandler";
import { createSessionMiddleware } from "./core/http/session";
import { requestIdMiddleware } from "./middleware/requestId";
import { requestContextMiddleware } from "./middleware/requestContext";
import { requestLogger } from "./middleware/requestLogger";
// FASE 7 — Rate limiting + critical action logging (in-memory, no DB).
import {
  apiLimiter,
  nfeLimiter,
  adminLimiter,
  highRiskActionLogger,
  criticalActionLogger,
} from "./core/security/rateLimit";
// FASE 14.6 — Session token version guard (enterprise session invalidation)
import { sessionVersionGuard } from "./core/security/sessionGuard";

/**
 * App factory.
 *
 * Architecture decision: index.ts is a *bootstrap* (load env, build app,
 * listen). All HTTP wiring lives here so the app can also be constructed
 * from tests, scripts, or a worker without booting a server.
 *
 * Order of registration matters:
 *   1. Body parsers + security headers + request logger
 *   2. Modular routers (new world) — take precedence
 *   3. Legacy `registerRoutes` — still serves un-migrated endpoints
 *   4. Vite/static (only after all API routes)
 *   5. Central error handler — must be last
 */
export interface BuildAppResult {
  app: Express;
  httpServer: Server;
}

export async function buildApp(): Promise<BuildAppResult> {
  const app = express();
  const httpServer = createServer(app);

  // Request-ID FIRST: every downstream middleware (parsers, security headers,
  // request logger, session, modular routes, legacy routes, error handler)
  // can rely on `req.requestId` being a non-empty string. Also sets the
  // `X-Request-Id` response header so clients can include it in bug reports.
  app.use(requestIdMiddleware);

  // FASE 12 — Bridge `req.requestId` para AsyncLocalStorage de
  // request context. Permite que services/guards (sem acesso a `req`)
  // emitam logs `[SECURITY]` correlacionados via `getRequestId()`.
  // Pattern oficial Node: este store é independente do tenantContext.
  app.use(requestContextMiddleware);

  // Entry/exit logger SECOND: depends on `req.requestId` being set, must run
  // before any router so the "incoming" line is emitted as early as possible
  // and `res.on('finish')` captures the true end-of-response status/duration
  // even when downstream middleware short-circuits the pipeline.
  app.use(requestLogger);

  // Allow request handlers to read raw body when needed (webhooks, signatures).
  app.use(
    express.json({
      limit: "25mb",
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: "25mb" }));

  // Security headers + cache policy for /api
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (req.path.startsWith("/api")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    next();
  });

  // Block sensitive file extensions (defense in depth).
  app.use((req, res, next) => {
    const BLOCKED = [".map", ".dev", ".source"];
    if (BLOCKED.some((ext) => req.path.endsWith(ext))) {
      return res.status(403).json({ message: "Acesso negado" });
    }
    next();
  });

  // Serve uploaded user content (product images, etc.) from disk.
  // Lives at `/uploads/...` and shares the same path layout the upload
  // endpoint returns. We register it BEFORE the modular routers so the
  // request never falls into the API path matchers, and BEFORE Vite so
  // dev mode also serves these files. Directory is created on demand.
  const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  app.use(
    "/uploads",
    express.static(UPLOADS_DIR, {
      // Long cache: filenames are content-hashed (random suffix) so they
      // are effectively immutable. Browsers and CDNs can cache aggressively.
      maxAge: "30d",
      fallthrough: true,
    }),
  );

  // Request logger for /api responses.
  app.use((req, res, next) => {
    const start = Date.now();
    let captured: unknown;
    const orig = res.json;
    res.json = function (body, ...args) {
      captured = body;
      return orig.apply(res, [body, ...args]);
    };
    res.on("finish", () => {
      if (req.path.startsWith("/api")) {
        const time = new Date().toLocaleTimeString("en-US", { hour12: true });
        const duration = Date.now() - start;
        let line = `${req.method} ${req.path} ${res.statusCode} in ${duration}ms`;
        if (captured) line += ` :: ${JSON.stringify(captured)}`;
        // Prefix with requestId so this line correlates with the entry/exit
        // logs from `requestLogger` and any controller/errorHandler logs.
        // Format intentionally preserved: only the `[<reqId>]` prefix is new.
        console.log(`${time} [${req.requestId}] [express] ${line}`);
      }
    });
    next();
  });

  // Session middleware — centralized so every modular router AND the legacy
  // router share the same session store. MUST come before registerModules
  // so the auth module can read/write `req.session` (login, logout, /me).
  app.use(createSessionMiddleware());

  // ── FASE 14.6: Session version guard ────────────────────────────────────
  // Mounted immediately after session so the tokenVersion check runs before
  // any business logic. Skip auth paths (login/logout/force-password-change)
  // and unauthenticated requests — guard logic handles these internally.
  app.use(sessionVersionGuard);
  // ── end FASE 14.6 ────────────────────────────────────────────────────────

  // ── FASE 7: Rate limiting + critical action logging ─────────────────────
  // Mounted AFTER session (so req.session is readable in criticalActionLogger)
  // and BEFORE all route registrations so every variant (/api, /api/v1,
  // /api/v2) is covered by a single mount per path prefix.
  //
  // Rules:
  //   • apiLimiter     — 60 req/min per IP  → /api/orders, /api/import
  //   • nfeLimiter     — 30 req/min per IP  → /api/nfe
  //   • adminLimiter   — 40 req/min per IP  → /api/admin
  //   • highRiskActionLogger — log-only, POST/DELETE on NF-e
  //   • criticalActionLogger — log-only, specific emission/admin ops
  //
  // /api/auth is intentionally omitted here: the login-specific IP limiter
  // (5 attempts / 5 min) is mounted directly on POST /login in auth.routes.ts.
  // The /me and /logout endpoints are low-risk and intentionally unlimited.
  app.use("/api/orders", apiLimiter);
  app.use("/api/v1/orders", apiLimiter);
  app.use("/api/v2/orders", apiLimiter);

  app.use("/api/import", apiLimiter);
  app.use("/api/v1/import", apiLimiter);

  app.use("/api/nfe", nfeLimiter);
  app.use("/api/v1/nfe", nfeLimiter);
  app.use("/api/nfe", highRiskActionLogger);
  app.use("/api/nfe", criticalActionLogger);

  app.use("/api/admin", adminLimiter);
  app.use("/api/v1/admin", adminLimiter);
  app.use("/api/admin", criticalActionLogger);
  // ── end FASE 7 ──────────────────────────────────────────────────────────

  // 1) Modular routes — registered in version order so v2 wins ties,
  //    then v1, then the unversioned legacy-compat paths.
  //    All three share the same service/repository/business-logic layer.
  registerV2Modules(app); // /api/v2/* — full apiResponse envelope guarantee
  registerV1Modules(app); // /api/v1/* — same behaviour as legacy, versioned alias
  registerModules(app);   // /api/*   — unversioned, backward-compat forever

  // 2) Legacy monolithic routes — kept until every endpoint has a module.
  await registerRoutes(httpServer, app);

  // 3) Central error middleware (must be the very last `app.use`).
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) =>
    errorHandler(err, req, res, next),
  );

  return { app, httpServer };
}
