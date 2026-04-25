import type { Response } from "express";

/**
 * Standardised API response helpers.
 *
 * Every modular endpoint should use these so the frontend can treat all
 * responses uniformly via the shared envelope:
 *
 *   Success: { success: true, data: T, meta?: ResponseMeta }
 *   Failure: { success: false, error: { message, code, details? } }
 *
 * The failure envelope is also produced by the central errorHandler when an
 * AppError or ZodError bubbles up — both shapes are identical.
 */

export interface ResponseMeta {
  pagination?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: ResponseMeta;
}

export interface ApiFailure {
  success: false;
  error: {
    message: string;
    code: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 200 OK — standard success envelope. Pass `meta` for pagination/filters. */
export function ok<T>(
  res: Response,
  data: T,
  meta?: ResponseMeta,
  status = 200,
): Response<ApiSuccess<T>> {
  const body: ApiSuccess<T> = meta
    ? { success: true, data, meta }
    : { success: true, data };
  return res.status(status).json(body);
}

/** 201 Created — standard success envelope. */
export function created<T>(
  res: Response,
  data: T,
  meta?: ResponseMeta,
): Response<ApiSuccess<T>> {
  return ok(res, data, meta, 201);
}

/** 204 No Content — intentionally empty body. */
export function noContent(res: Response): Response {
  return res.status(204).send();
}

/**
 * Explicit failure response. Prefer throwing an `AppError` so the central
 * errorHandler formats it consistently; reach for `fail()` only when you need
 * to short-circuit without throwing.
 */
export function fail(
  res: Response,
  message: string,
  code = "INTERNAL_ERROR",
  status = 500,
  details?: unknown,
): Response<ApiFailure> {
  const body: ApiFailure = {
    success: false,
    error:
      details === undefined ? { message, code } : { message, code, details },
  };
  return res.status(status).json(body);
}
