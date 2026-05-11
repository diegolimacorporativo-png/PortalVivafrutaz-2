import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../../shared/errors/AppError";
import { recordError } from "../observability/error-store";
import { incTotalErrors, incErrorsByRoute, incNfeFailures } from "../observability/metrics";
import { getRequestContext } from "../context/requestContext";

/**
 * Central error-handling middleware.
 *
 * Architecture decision: we map known error types to clean HTTP responses
 * here so every module gets consistent error semantics for free. Unknown
 * errors are logged and returned as 500 — never silently swallowed.
 *
 * FASE 2: 5xx errors are now recorded into the operational error store
 * and metrics counters are incremented. Observability is best-effort —
 * errors inside the recording path are swallowed to guarantee the
 * response always reaches the client.
 *
 * Mount this LAST in app.ts, after every router.
 */
export function errorHandler(
  err: unknown,
  req: Request,
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

    // Record 5xx AppErrors into the error store
    if (err.status >= 500) {
      _captureError(err, req, err.status, "ERROR");
    }

    return res.status(err.status).json({ success: false, error: body });
  }

  // ── Unknown / unexpected error ──────────────────────────────────────
  const e = err as { status?: number; statusCode?: number; message?: string; stack?: string };
  const status = e?.status || e?.statusCode || 500;
  const message = e?.message || "Erro interno do servidor";

  if (status >= 500) {
    console.error(`[${req.requestId}] [errorHandler] unhandled error:`, err);
    _captureError(err, req, status, "ERROR");
  }

  return res.status(status).json({
    success: false,
    error: { message, code: "INTERNAL_ERROR" },
  });
}

/**
 * Best-effort capture of a request error into the operational store.
 * Never throws — observability must not interrupt the response path.
 */
function _captureError(
  err: unknown,
  req: Request,
  statusCode: number,
  severity: "ERROR" | "WARN",
): void {
  try {
    const e = err as { message?: string; stack?: string };
    const ctx = getRequestContext();

    recordError({
      requestId: req.requestId ?? "unknown",
      endpoint: req.path,
      method: req.method,
      statusCode,
      severity,
      message: e?.message ?? "Unknown error",
      // T906 — suppress full stack traces in production; stack is a dev/debug tool only
      stack: process.env.NODE_ENV !== "production" ? e?.stack : undefined,
      tenantId: ctx?.tenantId,
      actorId: ctx?.actorId,
      role: ctx?.role,
      ip: ctx?.ip,
    });

    incTotalErrors();
    incErrorsByRoute(req.path);

    // Increment NF-e failure counter for fiscal/nfe routes
    if (req.path.includes("/nfe") || req.path.includes("/fiscal")) {
      incNfeFailures();
    }
  } catch {
    // never break the response path
  }
}
