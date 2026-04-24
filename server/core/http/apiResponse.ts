import type { Response } from "express";

/**
 * Standardized API response shape.
 *
 * Architecture decision: every modular endpoint returns the same envelope so
 * the frontend can treat all responses uniformly. The legacy routes.ts still
 * returns ad-hoc shapes; we explicitly do not break that, but new modules are
 * required to use these helpers.
 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: {
    message: string;
    code: string;
    details?: unknown;
  };
}

export function ok<T>(res: Response, data: T, status = 200): Response<ApiSuccess<T>> {
  return res.status(status).json({ success: true, data });
}

export function created<T>(res: Response, data: T): Response<ApiSuccess<T>> {
  return ok(res, data, 201);
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}
