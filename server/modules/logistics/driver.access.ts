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
 *   • DRIVER_OR_INTERNAL_ROLES — superset that additionally allows DRIVER
 *     and the legacy Portuguese alias MOTORISTA.
 *   • resolveOwnDriverId(storageCompat, actor) — resolves the driver id that
 *     belongs to the given user. FASE MT-1: now uses a Drizzle SQL query
 *     scoped to actor.empresaId instead of a full-table storage.getDrivers()
 *     scan followed by in-memory find(). The first parameter is kept for
 *     backward-compat (callers need not change) but is no longer used.
 *
 * Returns `null` if no link can be established. For GPS submission, callers
 * should use ensureOwnDriverId so legacy driver accounts can be provisioned
 * into the operational table on their first real location update.
 */

import { LOGISTICS_AUTH_ROLES } from "./logistics.types";
import { db } from "../../database/db";
import { logisticsDrivers } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/** Canonical "internal logistics user" set (re-uses the existing constant). */
export const LOGISTICS_INTERNAL_ROLES: readonly string[] = LOGISTICS_AUTH_ROLES;

/** Roles allowed on driver-scoped endpoints (`/api/driver/*`). */
export const DRIVER_OR_INTERNAL_ROLES: readonly string[] = [
  ...LOGISTICS_AUTH_ROLES,
  "DRIVER",
  "MOTORISTA",
];

export function isDriver(role: string | null | undefined): boolean {
  return role === "DRIVER" || role === "MOTORISTA";
}

export function isInternal(role: string | null | undefined): boolean {
  return !!role && LOGISTICS_INTERNAL_ROLES.includes(role);
}

export function isDriverOrInternal(role: string | null | undefined): boolean {
  return isDriver(role) || (!!role && LOGISTICS_INTERNAL_ROLES.includes(role));
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
  actor: {
    email?: string | null;
    name?: string | null;
    empresaId?: number | null;
  } | null | undefined,
): Promise<number | null> {
  if (!actor) return null;

  // Legacy accounts are not consistent about capitalization or trailing
  // whitespace (for example, "Alex " and "Alex@..."). Normalize both sides
  // in SQL so the lookup behaves like the login identity lookup.
  const tenantId = actor.empresaId ?? null;
  const tenantCondition = (identity: SQL<unknown>) =>
    tenantId == null
      ? identity
      : and(eq(logisticsDrivers.empresaId, tenantId), identity)!;

  // Email is the preferred identity. Name is deliberately only a fallback;
  // this keeps a changed display name from taking precedence over a stable
  // account email while still supporting old rows without email.
  if (actor.email?.trim()) {
    const emailRows = await db
      .select({ id: logisticsDrivers.id })
      .from(logisticsDrivers)
      .where(
        tenantCondition(
          sql`lower(trim(${logisticsDrivers.email})) = lower(trim(${actor.email.trim()}))`,
        ),
      )
      .limit(1);
    if (emailRows[0]?.id) return emailRows[0].id;
  }

  if (actor.name?.trim()) {
    const nameRows = await db
      .select({ id: logisticsDrivers.id })
      .from(logisticsDrivers)
      .where(
        tenantCondition(
          sql`lower(trim(${logisticsDrivers.name})) = lower(trim(${actor.name.trim()}))`,
        ),
      )
      .limit(1);
    if (nameRows[0]?.id) return nameRows[0].id;
  }

  return null;
}

/**
 * Resolve a driver's operational record, provisioning a missing legacy link
 * only when the driver is actually sending a GPS position.
 *
 * We intentionally do not create rows from read endpoints. This keeps GPS
 * listing side-effect free while allowing old user accounts (MOTORISTA/DRIVER)
 * to become fully trackable as soon as they grant browser location access.
 */
export async function ensureOwnDriverId(
  storageCompat: { getDrivers: () => Promise<any[]> },
  actor: {
    email?: string | null;
    name?: string | null;
    empresaId?: number | null;
  } | null | undefined,
): Promise<number | null> {
  const existingId = await resolveOwnDriverId(storageCompat, actor);
  if (existingId) return existingId;

  const tenantId = actor?.empresaId ?? null;
  const name = actor?.name?.trim();
  // Older driver accounts may be global (empresaId = NULL). They are still
  // valid identities; the GPS write is the explicit moment when the
  // operational row is created.
  if (!name) return null;

  const [created] = await db
    .insert(logisticsDrivers)
    .values({
      empresaId: tenantId,
      name,
      email: actor?.email?.trim() || null,
      active: true,
    })
    .returning({ id: logisticsDrivers.id });

  return created?.id ?? null;
}
