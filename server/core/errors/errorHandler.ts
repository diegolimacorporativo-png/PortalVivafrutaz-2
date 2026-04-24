import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "./AppError";

/**
 * Central error-handling middleware.
 *
 * Architecture decision: we map known error types to clean HTTP responses
 * here so every module gets consistent error semantics for free. Unknown
 * errors are logged and returned as 500 — never silently swallowed.
 *
 * Mount this LAST in app.ts, after every router.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (res.headersSent) return next(err);

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        message: "Dados de entrada inválidos",
        code: "VALIDATION_ERROR",
        details: err.errors,
      },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: {
        message: err.message,
        code: err.code,
        details: err.details,
      },
    });
  }

  const e = err as { status?: number; statusCode?: number; message?: string };
  const status = e?.status || e?.statusCode || 500;
  const message = e?.message || "Erro interno do servidor";

  if (status >= 500) {
    console.error("[errorHandler] unhandled error:", err);
  }

  return res.status(status).json({
    success: false,
    error: { message, code: "INTERNAL_ERROR" },
  });
}
