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

export function validateRequest(schema: ZodSchema, slot: Slot = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.parse((req as any)[slot]);
    (req as any)[slot] = parsed;
    next();
  };
}
