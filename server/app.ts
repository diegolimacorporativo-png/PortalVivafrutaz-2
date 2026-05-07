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

export interface BuildAppResult {
  app: Express;
  httpServer: Server;
}

export async function buildApp(): Promise<BuildAppResult> {
  enforceSchemaContract();
  const app = express();
  const httpServer = createServer(app);

  // CORS — permite origens do Replit dev e domínio de produção
  const allowedOrigins = [
    /\.replit\.dev$/,
    /\.replit\.app$/,
    /^http:\/\/localhost(:\d+)?$/,
  ];
  app.use(
    cors({
      origin: (origin, callback) => {
        // sem origin (server-to-server, curl, mobile apps) — permitido
        if (!origin) return callback(null, true);
        const allowed = allowedOrigins.some((pattern) =>
          typeof pattern === "string" ? origin === pattern : pattern.test(origin),
        );
        if (allowed) return callback(null, true);
        return callback(new Error(`CORS: origem não permitida — ${origin}`));
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
