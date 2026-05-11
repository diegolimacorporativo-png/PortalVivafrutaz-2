import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "http";
import cors from "cors";
import path from "path";
import fs from "fs";
import { registerModules, registerV1Modules, registerV2Modules } from "./modules";
import { registerRoutes } from "./routes/routes";
import { errorHandler } from "./core/errors/errorHandler";
import { createSessionMiddleware } from "./core/http/session";
import { requestIdMiddleware } from "./middleware/requestId";
import { requestContextMiddleware } from "./middleware/requestContext";
import { requestLogger } from "./middleware/requestLogger";
import {
  apiLimiter,
  nfeLimiter,
  adminLimiter,
  publicLimiter,
  searchLimiter,
  highRiskActionLogger,
  criticalActionLogger,
} from "./core/security/rateLimit";
import { sessionVersionGuard } from "./core/security/sessionGuard";
import { enforceSchemaContract } from "./core/security/schemaEnforcement";
import { enrichRequestContext } from "./core/context/requestContext";
import { incTotalRequests, incRequestsByTenant, recordLatency } from "./core/observability/metrics";

export interface BuildAppResult {
  app: Express;
  httpServer: Server;
}

export async function buildApp(): Promise<BuildAppResult> {
  enforceSchemaContract();
  const app = express();
  // F1-E4: remove Express fingerprint header
  app.disable("x-powered-by");
  const httpServer = createServer(app);

  // CORS — permite origens do Replit dev e domínio de produção
  const allowedOrigins = [
    /\.replit\.dev$/,
    /\.replit\.app$/,
    /^http:\/\/localhost(:\d+)?$/,
  ];

  // F1-E4: Block invalid origins with 403 BEFORE cors() processes them.
  // Previously a callback(new Error(...)) propagated to the global error
  // handler and returned 500 + internal error detail. Now invalid origins
  // are rejected here cleanly — no stack trace, no origin reflected in body.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin &&
      !allowedOrigins.some((p) =>
        typeof p === "string" ? origin === p : p.test(origin),
      )
    ) {
      return res.status(403).json({ message: "Acesso negado" });
    }
    next();
  });

  app.use(
    cors({
      origin: (origin, callback) => {
        // sem origin (server-to-server, curl, mobile apps) — permitido
        if (!origin) return callback(null, true);
        const allowed = allowedOrigins.some((pattern) =>
          typeof pattern === "string" ? origin === pattern : pattern.test(origin),
        );
        if (allowed) return callback(null, true);
        // Pre-middleware above already rejected unknown origins with 403;
        // this path is a safety fallback — deny without throwing.
        return callback(null, false);
      },
      credentials: true,
    }),
  );

  app.use(requestIdMiddleware);
  app.use(requestContextMiddleware);
  app.use(requestLogger);
  app.use(
    express.json({
      limit: "25mb",
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: "25mb" }));

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // H2-FIX: Content-Security-Policy header added.
    // Restricts resource origins to self + CDN fonts + inline scripts/styles
    // required by Vite HMR in dev. In production, unsafe-eval and unsafe-inline
    // can be tightened further once a nonce strategy is in place.
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob:",
        "connect-src 'self' wss: ws:",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    );
    if (req.path.startsWith("/api")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    next();
  });

  app.use((req, res, next) => {
    const BLOCKED = [".map", ".dev", ".source"];
    if (BLOCKED.some((ext) => req.path.endsWith(ext))) {
      return res.status(403).json({ message: "Acesso negado" });
    }
    next();
  });

  const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  app.use(
    "/uploads",
    express.static(UPLOADS_DIR, {
      maxAge: "30d",
      fallthrough: true,
    }),
  );

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
        console.log(`${time} [${req.requestId}] [express] ${line}`);
      }
    });
    next();
  });

  app.use(createSessionMiddleware());
  app.use(sessionVersionGuard);

  // FASE 2 — Enrich request context with actor/tenant from session.
  // Runs after session middleware so session fields are populated.
  // Best-effort: never throws, never alters response.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    try {
      const session = (req as any).session;
      if (session?.userId) {
        enrichRequestContext({
          actorId: session.userId,
          role: session.userRole ?? undefined,
          tenantId: session.empresaId ?? undefined,
        });
      } else if (session?.companyId) {
        enrichRequestContext({ tenantId: session.companyId });
      }
    } catch {
      // observability must never disrupt the request path
    }
    next();
  });

  // FASE 2 — Request metrics. Runs after session so tenant is available.
  app.use((req: Request, res: Response, next: NextFunction) => {
    try {
      incTotalRequests();
      const session = (req as any).session;
      const tenantId = session?.companyId ?? session?.empresaId;
      if (tenantId) incRequestsByTenant(tenantId);
      const start = Date.now();
      res.on("finish", () => {
        try { recordLatency(req.path, Date.now() - start); } catch { /* */ }
      });
    } catch {
      // never disrupt the request path
    }
    next();
  });
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
  // Public endpoint rate-guard (no auth, must be protected against ping-flood)
  app.use("/api/health", publicLimiter);
  // Search limiter — 7 SQL queries per request, authenticated users not exempt
  app.use("/api/search", searchLimiter);

  registerV2Modules(app);
  registerV1Modules(app);
  registerModules(app);
  await registerRoutes(httpServer, app);

  // NOTE: an API 404 guard is NOT registered here because Vite's Connect
  // server (app.use(vite.middlewares) in server/vite.ts) intercepts every
  // unmatched request internally before Express can evaluate any middleware
  // added after registerRoutes(). The guard lives in server/vite.ts,
  // immediately before app.use(vite.middlewares), where it reliably fires
  // for every /api/* path that has no real route handler.
  // In production (server/static.ts) the equivalent guard is inside the
  // /{*path} catch-all that replaces vite.middlewares.

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) =>
    errorHandler(err, req, res, next),
  );

  return { app, httpServer };
}
