import type { Response } from "express";

/**
 * Standardized API response shape.
 *
 * Architecture decision: every NEW modular endpoint returns the same envelope
 * so the frontend can treat all responses uniformly. The legacy `routes.ts`
 * and the auth/users modules deliberately return raw shapes for backward
 * compatibility with the existing frontend — see their controller doc-blocks.
 * Migrating those is an opt-in, per-module change that must be paired with a
 * matching frontend update (use `normalizeList` on the client).
 *
 * Success envelope:
 *   { success: true, data: <T>, meta?: { pagination?, filters?, ... } }
 *
 * Failure envelope (produced by `fail()` here OR by the central errorHandler
 * when an AppError/ZodError bubbles up — both shapes are identical):
 *   { success: false, error: { message: string, code: string, details?: any } }
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

/**
 * 200 OK with the standard envelope. Pass `meta` for pagination/filters/etc.
 */
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

/**
 * 201 Created with the standard envelope.
 */
export function created<T>(
  res: Response,
  data: T,
  meta?: ResponseMeta,
): Response<ApiSuccess<T>> {
  return ok(res, data, meta, 201);
}

/**
 * 204 No Content — body is intentionally empty (no envelope).
 */
export function noContent(res: Response): Response {
  return res.status(204).send();
}

/**
 * Failure envelope. Prefer throwing an AppError so the central errorHandler
 * formats it consistently; reach for `fail()` only when you need to short-
 * circuit a response from inside a controller without throwing.
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
    error: details === undefined ? { message, code } : { message, code, details },
  };
  return res.status(status).json(body);
}
