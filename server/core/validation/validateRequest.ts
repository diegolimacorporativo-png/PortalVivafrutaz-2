import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

/**
 * validateRequest — run a Zod schema against body/query/params and replace
 * the request slot with the parsed (and typed) value.
 *
 * Architecture decision: validation is a layer, not scattered inside
 * controllers. The schema lives in `<module>.validation.ts`, the controller
 * receives already-validated, type-safe data. Errors are caught by the
 * central errorHandler (ZodError → 400).
 */
type Slot = "body" | "query" | "params";

/**
 * Express 5 made `req.query` (and in some cases `req.params`) read-only
 * getters, so the previous `req[slot] = parsed` assignment threw
 * `Cannot set property query of #<IncomingMessage> which has only a getter`
 * for every validated query/params handler. We instead stash the parsed
 * value on `req.validated[slot]` and, when safe, also copy individual
 * fields back onto the original slot so legacy controllers that still read
 * `req.query.foo` keep working.
 */
declare module "express-serve-static-core" {
  interface Request {
    validated?: {
      body?: unknown;
      query?: unknown;
      params?: unknown;
    };
  }
}

export function validateRequest(schema: ZodSchema, slot: Slot = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.parse((req as any)[slot]);

    req.validated = req.validated ?? {};
    (req.validated as any)[slot] = parsed;

    if (slot === "body") {
      // body is writable in Express 5 — keep legacy `req.body` access working.
      (req as any).body = parsed;
    } else if (parsed && typeof parsed === "object") {
      // query/params are read-only getters in Express 5. Mutate the existing
      // object in place so `req.query.foo` / `req.params.foo` still resolve to
      // the parsed/coerced values without reassigning the slot itself.
      const target = (req as any)[slot] as Record<string, unknown> | undefined;
      if (target) {
        for (const key of Object.keys(parsed as Record<string, unknown>)) {
          target[key] = (parsed as Record<string, unknown>)[key];
        }
      }
    }

    next();
  };
}
