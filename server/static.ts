import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist.
  // Guard: API routes that reach here have no handler — return JSON 404.
  app.use("/{*path}", (req, res) => {
    if (req.originalUrl.startsWith("/api")) {
      res.status(404).json({
        success: false,
        error: "API route not found",
        path: req.originalUrl,
      });
      return;
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
