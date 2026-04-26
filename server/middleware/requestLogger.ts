import type { Request, Response, NextFunction } from "express";

/**
 * Request entry/exit logger.
 *
 * Logs a single line when the request enters the pipeline and another when
 * the response finishes, both stamped with `req.requestId` so a single
 * call can be greppered across:
 *   - this entry log
 *   - any controller `console.warn(\`[${req.requestId}] [<scope>] …\`, err)`
 *   - the central `errorHandler` log line
 *   - this exit log (with status + duration)
 *
 * Format (verbatim, do not change without coordinating with grep tooling):
 *   [<reqId>] --> METHOD ORIGINAL_URL
 *   [<reqId>] <-- METHOD ORIGINAL_URL STATUS DURATIONms
 *
 * Notes:
 *   - This middleware MUST be mounted AFTER `requestIdMiddleware` so
 *     `req.requestId` is already populated.
 *   - We never mutate `res` (no header changes, no body wrapping). The only
 *     side effect is a `res.on('finish')` listener that fires after the
 *     response has been flushed, so it cannot interfere with delivery.
 *   - The pre-existing `[express] METHOD PATH STATUS in Xms :: { … }`
 *     logger in `server/app.ts` is intentionally preserved alongside this
 *     one — it captures response bodies for debugging and is consumed by
 *     existing log-grep automation.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();

  console.info(`[${req.requestId}] --> ${req.method} ${req.originalUrl}`);

  res.on("finish", () => {
    const duration = Date.now() - start;
    console.info(
      `[${req.requestId}] <-- ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`,
    );
  });

  next();
}
