import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../../shared/errors/AppError";

/**
 * Central error-handling middleware.
 *
 * Architecture decision: we map known error types to clean HTTP responses
 * here so every module gets consistent error semantics for free. Unknown
 * errors are logged and returned as 500 — never silently swallowed.
 *
 * Mount this LAST in app.ts, after every router.
 *
 * Every operational error in the codebase extends `AppError` from
 * `server/shared/errors/AppError.ts` — the single source of truth. The
 * `instanceof AppError` check below is therefore reliable across all
 * modules and preserves `status`, `code`, and `details` consistently.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (res.headersSent) return next(err);

  // ── Zod validation error ────────────────────────────────────────────
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

  // ── Operational error (AppError hierarchy) ──────────────────────────
  if (err instanceof AppError) {
    const body: Record<string, unknown> = {
      message: err.message,
      code: err.code,
    };
    if (err.details !== undefined) body.details = err.details;

    return res.status(err.status).json({ success: false, error: body });
  }

  // ── Unknown / unexpected error ──────────────────────────────────────
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
