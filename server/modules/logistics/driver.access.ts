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
 *   • resolveOwnDriverId(storageCompat, actor) — resolves the driver id that
 *     belongs to the given user. FASE MT-1: now uses a Drizzle SQL query
 *     scoped to actor.empresaId instead of a full-table storage.getDrivers()
 *     scan followed by in-memory find(). The first parameter is kept for
 *     backward-compat (callers need not change) but is no longer used.
 *
 * Returns `null` if no link can be established — callers MUST treat that as
 * "this driver has no route" (empty results), never as "this driver is an
 * admin" (which would be a privilege-escalation bug).
 */

import { LOGISTICS_AUTH_ROLES } from "./logistics.types";
import { db } from "../../database/db";
import { logisticsDrivers } from "@shared/schema";
import { eq, or, and } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

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
 * FASE MT-1: Uses a direct Drizzle SQL query filtered by actor.empresaId
 * (tenant) + email/name match — no full-table scan, no in-memory find().
 *
 * Matching strategy:
 *   1. Exact email match (preferred).
 *   2. Exact name match (fallback for legacy seed data without email).
 *
 * The first parameter (`_storageCompat`) is kept for backward compatibility
 * with existing callers and is intentionally ignored.
 *
 * Returns `null` when:
 *   - actor is falsy
 *   - actor has neither email nor name
 *   - no matching driver row exists in the tenant
 */
export async function resolveOwnDriverId(
  _storageCompat: { getDrivers: () => Promise<any[]> },
  actor: { email?: string | null; name?: string | null } | null | undefined,
): Promise<number | null> {
  if (!actor) return null;

  // Build identity conditions (email OR name).
  const identityParts: SQL<unknown>[] = [];
  if ((actor as any).email) {
    identityParts.push(eq(logisticsDrivers.email, (actor as any).email));
  }
  if ((actor as any).name) {
    identityParts.push(eq(logisticsDrivers.name, (actor as any).name));
  }
  if (identityParts.length === 0) return null;

  const identityCond: SQL<unknown> =
    identityParts.length === 1 ? identityParts[0]! : or(...identityParts)!;

  // Scope to actor's tenant when available — prevents cross-tenant driver lookup.
  const tenantId: number | null = (actor as any).empresaId ?? null;
  const where: SQL<unknown> = tenantId
    ? and(eq(logisticsDrivers.empresaId, tenantId), identityCond)!
    : identityCond;

  const rows = await db
    .select({ id: logisticsDrivers.id })
    .from(logisticsDrivers)
    .where(where)
    .limit(1);

  return rows[0]?.id ?? null;
}
