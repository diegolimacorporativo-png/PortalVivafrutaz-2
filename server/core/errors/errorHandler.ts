import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

/**
 * Central error-handling middleware.
 *
 * Architecture decision: we map known error types to clean HTTP responses
 * here so every module gets consistent error semantics for free. Unknown
 * errors are logged and returned as 500 — never silently swallowed.
 *
 * Mount this LAST in app.ts, after every router.
 *
 * ── Why duck-typing instead of `instanceof AppError` ──────────────────
 * The codebase has two AppError class definitions:
 *   - `server/core/errors/AppError.ts`  (legacy, used by non-migrated modules)
 *   - `server/shared/errors/AppError.ts` (canonical, used by migrated modules)
 *
 * They are structurally identical but are separate JavaScript class objects.
 * `instanceof` compares prototype chains, so an error thrown from the shared
 * hierarchy always FAILS the `instanceof CoreAppError` check and falls through
 * to the generic 500 handler — losing the correct status code, error code,
 * and `details` payload (critical for ConflictError / fiscal confirmations).
 *
 * Duck-typing (`isOperationalError`) treats any object that carries a numeric
 * `status` and a string `code` as an operational error, regardless of which
 * class file it came from. This correctly handles:
 *   - core/errors/AppError subclasses  (legacy modules)
 *   - shared/errors/AppError subclasses (migrated modules — orders, users, …)
 *   - Any future third-party error that adopts the same shape
 */

/** Matches any AppError-shaped object from either hierarchy. */
function isOperationalError(
  err: unknown,
): err is { status: number; code: string; message: string; details?: unknown } {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as any).status === "number" &&
    typeof (err as any).code === "string" &&
    typeof (err as any).message === "string"
  );
}

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

  // ── Operational error (AppError from either hierarchy) ──────────────
  // Uses duck-typing so both `core/errors/AppError` and
  // `shared/errors/AppError` are handled identically — preserving the
  // correct HTTP status, machine-readable `code`, and `details` payload.
  if (isOperationalError(err)) {
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
