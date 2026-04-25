import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { ValidationError } from "../errors";

/**
 * Express middleware that validates req.body against a Zod schema.
 * On failure it passes a ValidationError to the next error handler.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.errors.map((e) => e.message).join(", ");
      return next(new ValidationError(message));
    }
    req.body = result.data;
    next();
  };
}
