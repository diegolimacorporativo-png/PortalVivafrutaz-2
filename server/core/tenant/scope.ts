import { eq, and, type SQL, type Column } from "drizzle-orm";
import { requireTenantId, currentTenantId } from "./context";

/**
 * Tenant scoping helpers.
 *
 * Architecture decision: every tenant-scoped Drizzle query funnels through
 * one of these helpers. Repositories never spell out `eq(table.tenantId, X)`
 * by hand — instead they call `tenantWhere(table)` and the helper guarantees
 * the predicate is present and reads the id from the request context, not
 * from caller-supplied input. That single rule is what makes cross-tenant
 * leaks impossible by construction.
 *
 * Naming standardization:
 *   - NEW code/tables use `tenantId` (the canonical name).
 *   - LEGACY tables that still expose `empresaId` (Portuguese for "company id"
 *     but used as the tenant marker) or `companyId` (where the tenant happens
 *     to be the same entity as the buyer company — e.g. `orders.companyId`)
 *     are auto-detected, so callers say `tenantWhere(orders)` regardless of
 *     the underlying field name. The standardization is enforced at the
 *     helper boundary; existing column names do not need to be migrated.
 */

/** A table whose tenant identity is one of: tenantId | empresaId | companyId. */
export type TenantTable =
  | { tenantId: Column }
  | { empresaId: Column }
  | { companyId: Column };

/**
 * Detect which column on `table` represents the tenant.
 *
 * Resolution order: `tenantId` (canonical) → `empresaId` (legacy pt-BR) →
 * `companyId` (where the tenant *is* the buyer company, e.g. `orders`).
 * Throws at runtime if the table has none of them — matching the spirit of
 * the compile-time `TenantTable` constraint for callers that bypass the type.
 */
export function tenantColumn(table: TenantTable): Column {
  const t = table as Record<string, Column | undefined>;
  const col = t.tenantId ?? t.empresaId ?? t.companyId;
  if (!col) {
    throw new Error(
      "tenantColumn(): table has no tenantId/empresaId/companyId column",
    );
  }
  return col;
}

/**
 * Detect the *TypeScript field name* that holds the tenant column on `table`.
 * Used by `withTenant()` to know which key to stamp on insert payloads. Same
 * resolution order as `tenantColumn()`.
 */
export function tenantFieldName(
  table: TenantTable,
): "tenantId" | "empresaId" | "companyId" {
  const t = table as Record<string, unknown>;
  if ("tenantId" in t && t.tenantId) return "tenantId";
  if ("empresaId" in t && t.empresaId) return "empresaId";
  if ("companyId" in t && t.companyId) return "companyId";
  throw new Error(
    "tenantFieldName(): table has no tenantId/empresaId/companyId field",
  );
}

/** Returns `eq(<tenantColumn>, currentTenantId)`; throws if no tenant. */
export function tenantWhere(table: TenantTable): SQL {
  return eq(tenantColumn(table), requireTenantId());
}

/** Combine tenant predicate with extra conditions. */
export function tenantAnd(
  table: TenantTable,
  ...conditions: (SQL | undefined)[]
): SQL {
  const all = [tenantWhere(table), ...conditions.filter((c): c is SQL => !!c)];
  return all.length === 1 ? all[0] : (and(...all) as SQL);
}

/**
 * Stamps an insert payload with the current tenant id. Two call shapes:
 *
 *   db.insert(accountsReceivable).values(withTenant(data))
 *     → uses the canonical `tenantId` field (NEW code).
 *
 *   db.insert(orders).values(withTenant(orders, data))
 *     → auto-detects the field name (`companyId` for orders, `empresaId`
 *       for legacy tables, `tenantId` for new tables).
 */
export function withTenant<T extends Record<string, unknown>>(
  data: T,
): T & { tenantId: number };
export function withTenant<T extends Record<string, unknown>>(
  table: TenantTable,
  data: T,
): T & Record<string, number>;
export function withTenant<T extends Record<string, unknown>>(
  tableOrData: TenantTable | T,
  maybeData?: T,
): T & Record<string, number> {
  const id = requireTenantId();
  if (maybeData === undefined) {
    return { ...(tableOrData as T), tenantId: id } as T & { tenantId: number };
  }
  const fieldName = tenantFieldName(tableOrData as TenantTable);
  return { ...(maybeData as T), [fieldName]: id };
}

/**
 * Bulk-insert variant. Shape mirrors `withTenant`.
 */
export function withTenantAll<T extends Record<string, unknown>>(
  rows: T[],
): Array<T & { tenantId: number }>;
export function withTenantAll<T extends Record<string, unknown>>(
  table: TenantTable,
  rows: T[],
): Array<T & Record<string, number>>;
export function withTenantAll<T extends Record<string, unknown>>(
  tableOrRows: TenantTable | T[],
  maybeRows?: T[],
): Array<T & Record<string, number>> {
  const id = requireTenantId();
  if (maybeRows === undefined) {
    return (tableOrRows as T[]).map((r) => ({ ...r, tenantId: id })) as Array<
      T & { tenantId: number }
    >;
  }
  const fieldName = tenantFieldName(tableOrRows as TenantTable);
  return (maybeRows as T[]).map((r) => ({ ...r, [fieldName]: id }));
}

/**
 * Escape hatch for queries that legitimately span tenants (admin dashboards,
 * background reconciliation jobs). Forces the caller to be explicit so a
 * grep for "crossTenant" surfaces every cross-tenant access in the codebase.
 */
export function crossTenant(): { _crossTenant: true } {
  if (currentTenantId() != null) {
    // Intentional: an admin in a tenant scope is opting out for one query.
  }
  return { _crossTenant: true };
}

/**
 * Strips any tenant-identifying field from an UPDATE payload so a malicious
 * patch body can't reassign tenancy. Use on every update repository method.
 */
export function stripTenantFields<T extends Record<string, unknown>>(
  data: T,
): T {
  const {
    tenantId: _t,
    empresaId: _e,
    companyId: _c,
    ...safe
  } = data as Record<string, unknown>;
  return safe as T;
}
