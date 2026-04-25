import { eq, and, type SQL } from "drizzle-orm";
import { requireTenantId, currentTenantId } from "./context";

/**
 * Tenant scoping helpers.
 *
 * Architecture decision: every tenant-scoped Drizzle query funnels through
 * one of these helpers. Repositories never spell out `eq(table.empresaId, X)`
 * by hand — instead they call `tenantWhere(table)` and the helper guarantees
 * the predicate is present and reads the id from the request context, not
 * from caller-supplied input. That single rule is what makes cross-tenant
 * leaks impossible by construction.
 *
 * Type parameter `T` is constrained to objects with an `empresaId` column so
 * any attempt to scope a table that has no tenant column is caught at
 * compile time.
 */
type TenantTable = { empresaId: any };

/** Returns `eq(table.empresaId, currentTenantId)`; throws if no tenant. */
export function tenantWhere<T extends TenantTable>(table: T): SQL {
  return eq(table.empresaId, requireTenantId());
}

/** Combine tenant predicate with extra conditions: `where(tenantAnd(table, eq(...), gte(...)))`. */
export function tenantAnd<T extends TenantTable>(
  table: T,
  ...conditions: (SQL | undefined)[]
): SQL {
  const all = [tenantWhere(table), ...conditions.filter((c): c is SQL => !!c)];
  return all.length === 1 ? all[0] : (and(...all) as SQL);
}

/**
 * Stamps an insert payload with the current tenant id. Use on every insert
 * into a tenant-scoped table:
 *   db.insert(accountsReceivable).values(withTenant(data))
 */
export function withTenant<T extends Record<string, unknown>>(
  data: T,
): T & { empresaId: number } {
  return { ...data, empresaId: requireTenantId() };
}

/**
 * Like `withTenant` but for arrays (e.g. bulk inserts of order items).
 */
export function withTenantAll<T extends Record<string, unknown>>(
  rows: T[],
): Array<T & { empresaId: number }> {
  const empresaId = requireTenantId();
  return rows.map((r) => ({ ...r, empresaId }));
}

/**
 * Escape hatch for queries that legitimately span tenants (admin dashboards,
 * background reconciliation jobs). Forces the caller to be explicit so a
 * grep for "crossTenant" surfaces every cross-tenant access in the codebase.
 */
export function crossTenant(): { _crossTenant: true } {
  if (currentTenantId() != null) {
    // We intentionally allow it but annotate — this lets reviewers see when a
    // tenant-scoped request opted out of scoping for a specific query.
  }
  return { _crossTenant: true };
}
