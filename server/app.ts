import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "http";
import { registerModules } from "./modules";
import { registerRoutes } from "./routes/routes";
import { errorHandler } from "./core/errors/errorHandler";
import { createSessionMiddleware } from "./core/http/session";

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
        console.log(`${time} [express] ${line}`);
      }
    });
    next();
  });

  // Session middleware — centralized so every modular router AND the legacy
  // router share the same session store. MUST come before registerModules
  // so the auth module can read/write `req.session` (login, logout, /me).
  app.use(createSessionMiddleware());

  // 1) New modular routes — registered first so they shadow any legacy
  //    duplicate path during the incremental migration.
  registerModules(app);

  // 2) Legacy monolithic routes — kept until every endpoint has a module.
  await registerRoutes(httpServer, app);

  // 3) Central error middleware (must be the very last `app.use`).
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) =>
    errorHandler(err, req, res, next),
  );

  return { app, httpServer };
}
