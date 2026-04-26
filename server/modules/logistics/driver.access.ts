/**
 * driver.access — STEP 8.7 RBAC helpers (single source of truth).
 *
 * No new tables, no migration. The `users.role` column is `text`, so the
 * new value `"DRIVER"` is just a string convention enforced at runtime.
 *
 * Three primitives shared by every endpoint that exposes per-driver data:
 *
 *   • LOGISTICS_INTERNAL_ROLES — read-only canonical list of internal roles
 *     that retain full visibility (mirrors LOGISTICS_AUTH_ROLES + extras).
 *   • DRIVER_OR_INTERNAL_ROLES — superset that additionally allows DRIVER.
 *   • resolveOwnDriverId(storage, actor) — joins `users.email` to
 *     `logistics_drivers.email` (falling back to `name`, matching the legacy
 *     `/api/driver/route-today` heuristic). Returns the driver's id or null.
 *
 * The helpers are intentionally framework-agnostic so they can be used both
 * from the legacy `server/routes/routes.ts` handlers and from the modular
 * `LogisticsController.routeTracking` method.
 */

import { LOGISTICS_AUTH_ROLES } from "./logistics.types";

/** Canonical "internal logistics user" set (re-uses the existing constant). */
export const LOGISTICS_INTERNAL_ROLES: readonly string[] = LOGISTICS_AUTH_ROLES;

/** Roles allowed on driver-scoped endpoints (`/api/driver/*`). */
export const DRIVER_OR_INTERNAL_ROLES: readonly string[] = [
  ...LOGISTICS_AUTH_ROLES,
  "DRIVER",
];

export function isInternal(role: string | null | undefined): boolean {
  return !!role && LOGISTICS_INTERNAL_ROLES.includes(role);
}

export function isDriverOrInternal(role: string | null | undefined): boolean {
  return !!role && DRIVER_OR_INTERNAL_ROLES.includes(role);
}

/**
 * Resolves the `logistics_drivers.id` that belongs to the given user.
 *
 * Matching strategy mirrors the existing `route-today` lookup so we stay
 * compatible with the data already in the system:
 *   1. Exact email match (preferred).
 *   2. Exact name match (fallback for legacy seed data without email).
 *
 * Returns `null` if no link can be established — callers MUST treat that as
 * "this driver has no route" (empty results), never as "this driver is an
 * admin" (which would be a privilege-escalation bug).
 */
export async function resolveOwnDriverId(
  storage: { getDrivers: () => Promise<any[]> },
  actor: { email?: string | null; name?: string | null } | null | undefined,
): Promise<number | null> {
  if (!actor) return null;
  const drivers = await storage.getDrivers();
  const match = drivers.find(
    (d: any) =>
      (actor.email && d.email && d.email === actor.email) ||
      (actor.name && d.name && d.name === actor.name),
  );
  return match?.id ?? null;
}
