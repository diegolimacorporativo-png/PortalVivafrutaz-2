/**
 * apiV2 — typed fetch client for /api/v2/* endpoints.
 *
 * Every /api/v2/* response follows ONE of three shapes:
 *
 *   Success (200 / 201)  →  { success: true, data: T }
 *   No Content (204)     →  empty body             (DELETE endpoints)
 *   Error (4xx / 5xx)    →  { success: false, error: { message, code, details? } }
 *
 * This helper handles all three uniformly so callers never need to inspect
 * status codes or call `.json()` conditionally. It throws a typed `ApiV2Error`
 * on non-2xx, which React Query surfaces through `isError` / `error`.
 *
 * Usage:
 *   const order  = await v2.get<Order>("/api/v2/orders/42");
 *   const result = await v2.post<Order>("/api/v2/orders", body);
 *   await v2.delete("/api/v2/orders/42");           // void — 204 no body
 *   await v2.delete("/api/v2/orders/bulk", ids);    // void — 204 no body
 */

import { fetchWithAuth } from "./fetchWithAuth";

export interface V2ErrorPayload {
  message: string;
  code: string;
  details?: unknown;
}

export class ApiV2Error extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, payload: V2ErrorPayload) {
    super(payload.message);
    this.name = "ApiV2Error";
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
    Object.setPrototypeOf(this, ApiV2Error.prototype);
  }
}

/** Parse a v2 response — returns `T` for 2xx+body, `null` for 204. */
async function parseV2<T>(res: globalThis.Response): Promise<T | null> {
  if (res.status === 204) return null;

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const err: V2ErrorPayload =
      body?.error && typeof body.error === "object"
        ? body.error
        : { message: body?.message || res.statusText, code: "UNKNOWN_ERROR" };
    throw new ApiV2Error(res.status, err);
  }

  return body?.data !== undefined ? (body.data as T) : (body as T);
}

/** Base fetch with credentials and JSON content-type via fetchWithAuth. */
async function request<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T | null> {
  const res = await fetchWithAuth(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parseV2<T>(res);
}

/** GET /api/v2/* → T */
export const v2 = {
  get<T>(url: string): Promise<T> {
    return request<T>("GET", url) as Promise<T>;
  },

  /** POST /api/v2/* — creation endpoints return 201 + body. */
  post<T>(url: string, body?: unknown): Promise<T> {
    return request<T>("POST", url, body) as Promise<T>;
  },

  /** PATCH /api/v2/* → T (200 with updated resource). */
  patch<T>(url: string, body?: unknown): Promise<T> {
    return request<T>("PATCH", url, body) as Promise<T>;
  },

  /** PUT /api/v2/* → T (200 with replaced resource). */
  put<T>(url: string, body?: unknown): Promise<T> {
    return request<T>("PUT", url, body) as Promise<T>;
  },

  /**
   * DELETE /api/v2/* → void (204 No Content).
   *
   * v2 DELETE endpoints return no body. Call sites do NOT need to call
   * `.json()` or guard against empty responses — this method handles it.
   * Throws `ApiV2Error` if the server returns a non-2xx status.
   */
  async delete(url: string, body?: unknown): Promise<void> {
    await request<never>("DELETE", url, body);
  },
} as const;
