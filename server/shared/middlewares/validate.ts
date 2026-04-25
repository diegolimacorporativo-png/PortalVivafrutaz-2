import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

/**
 * validate — Zod-schema middleware for body, query, or params.
 *
 * Mirrors the behaviour of `server/core/validation/validateRequest` so that
 * the orders module (and future modules) can swap to the shared path without
 * any behaviour change.
 *
 * Express 5 made `req.query` and `req.params` read-only getters, so we cannot
 * reassign those slots directly. Instead we:
 *   1. Store the parsed value on `req.validated[slot]` (always).
 *   2. For `body` — overwrite `req.body` (still writable in Express 5).
 *   3. For `query`/`params` — mutate the existing object in-place so that
 *      `req.query.foo` / `req.params.foo` resolve to the coerced value
 *      without triggering the read-only setter.
 *
 * Errors are forwarded to `next()` so the central errorHandler emits the
 * standard `{ success: false, error }` envelope (ZodError → 400).
 */

type Slot = "body" | "query" | "params";

declare module "express-serve-static-core" {
  interface Request {
    validated?: {
      body?: unknown;
      query?: unknown;
      params?: unknown;
    };
  }
}

export function validate(schema: ZodSchema, slot: Slot = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse((req as any)[slot]);

      req.validated = req.validated ?? {};
      (req.validated as any)[slot] = parsed;

      if (slot === "body") {
        (req as any).body = parsed;
      } else if (parsed && typeof parsed === "object") {
        const target = (req as any)[slot] as Record<string, unknown> | undefined;
        if (target) {
          for (const key of Object.keys(parsed as Record<string, unknown>)) {
            target[key] = (parsed as Record<string, unknown>)[key];
          }
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
