/**
 * Response normalizers for the standard API envelope.
 *
 * The backend is being migrated module-by-module from raw JSON
 * (`[]` / `{}`) to the standard envelope (`{ success, data, meta }`).
 * During the migration both shapes coexist, so every consumer that
 * touches a migrated endpoint should pipe its response through these
 * helpers. They accept any of:
 *
 *   - a raw array
 *   - a raw object
 *   - `{ success: true, data: ... }`
 *   - `{ data: ... }` (loose envelope)
 *   - `null` / `undefined`
 *
 * and always return a safe value (array or `T | null`) so `.map()`,
 * `.filter()`, `.reduce()`, etc. cannot throw.
 */

export interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  error?: { message?: string; code?: string; details?: unknown };
}

/**
 * Normalize any API response into a guaranteed `T[]`.
 */
export function normalizeList<T = unknown>(response: unknown): T[] {
  if (response == null) return [];
  if (Array.isArray(response)) return response as T[];
  if (typeof response === "object") {
    const env = response as ApiEnvelope<unknown>;
    if (Array.isArray(env.data)) return env.data as T[];
  }
  return [];
}

/**
 * Normalize any API response into a single `T | null`.
 * Returns null for arrays, missing payloads, or failure envelopes.
 */
export function normalizeOne<T = unknown>(response: unknown): T | null {
  if (response == null) return null;
  if (Array.isArray(response)) return null;
  if (typeof response === "object") {
    const env = response as ApiEnvelope<T>;
    if (env.success === false) return null;
    if (env.data !== undefined) return (env.data as T) ?? null;
    return response as T;
  }
  return null;
}

/**
 * Read the `meta` block (pagination, filters, etc.) when present.
 */
export function normalizeMeta(response: unknown): Record<string, unknown> {
  if (response && typeof response === "object") {
    const env = response as ApiEnvelope<unknown>;
    if (env.meta && typeof env.meta === "object") return env.meta;
  }
  return {};
}

/**
 * Pull the error block out of any failure response — works for both the
 * standard envelope (`{ success:false, error:{ message, code, details } }`)
 * and the legacy raw shape (`{ message, ...extras }`). Always returns an
 * object; missing fields fall back to `undefined` so destructuring is safe.
 *
 * Use this for failure handlers that need to read structured details (e.g.
 * a 409 carrying `requiresConfirmation`, `billedCount`, etc.).
 */
export interface NormalizedError {
  message?: string;
  code?: string;
  details?: any;
}
export function normalizeError(response: unknown): NormalizedError {
  if (!response || typeof response !== "object") return {};
  const env = response as ApiEnvelope<unknown>;
  if (env.error && typeof env.error === "object") {
    return {
      message: env.error.message,
      code: env.error.code,
      details: (env.error as any).details,
    };
  }
  // Legacy shape — the body itself IS the error payload.
  const raw = response as Record<string, any>;
  return { message: raw.message, code: raw.code, details: raw };
}
