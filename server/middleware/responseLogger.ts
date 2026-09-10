import type { Request, Response, NextFunction } from "express";

/**
 * Safe API response completion logger.
 *
 * Deliberately does not intercept res.json/res.send and never serializes the
 * response body. Response bodies can contain credentials, tokens, personal
 * data, financial values, or operational information.
 */
export function responseLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();

  res.on("finish", () => {
    if (!req.path.startsWith("/api")) return;

    const time = new Date().toLocaleTimeString("en-US", { hour12: true });
    const duration = Date.now() - start;
    const contentLength = res.getHeader("content-length");
    const size = contentLength !== undefined ? ` ${String(contentLength)}b` : "";
    console.log(
      `${time} [${req.requestId}] [express] ${req.method} ${req.path} ${res.statusCode} in ${duration}ms${size}`,
    );
  });

  next();
}