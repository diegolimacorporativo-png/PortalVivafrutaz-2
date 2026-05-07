import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  // API 404 guard: must live here, immediately before vite.middlewares,
  // because vite.middlewares completes every unmatched request (including
  // /api/*) by serving index.html — the Express /{*path} catch-all and
  // app.use("/api"…) guards registered earlier in buildApp() are never
  // reached for unhandled routes because vite.middlewares swallows them.
  app.use((req, res, next) => {
    if (req.originalUrl.startsWith("/api")) {
      console.log(`[API_404_GUARD_VITE] returning 404 for ${req.originalUrl}`);
      res.status(404).json({
        success: false,
        error: "API route not found",
        path: req.originalUrl,
      });
      return;
    }
    next();
  });

  app.use(vite.middlewares);

  app.use("/{*path}", async (req, res, next) => {
    const url = req.originalUrl;

    // Any /api/* request that reaches the SPA catch-all has no matching
    // route handler — return JSON 404 instead of serving index.html.
    // This prevents REST clients from silently receiving HTML on typos or
    // missing routes, and keeps the API contract predictable.
    if (url.startsWith("/api")) {
      res.status(404).json({
        success: false,
        error: "API route not found",
        path: url,
      });
      return;
    }

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
