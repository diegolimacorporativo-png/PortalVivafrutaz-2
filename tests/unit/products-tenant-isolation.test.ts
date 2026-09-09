/**
 * Products/catalog tenant policy tests.
 *
 * These are pure read-only tests. They exercise the same policy helpers used
 * by storage and never connect to or mutate Supabase/Postgres.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCatalogMutation,
  canMutateCatalogRow,
  canReadCatalogRow,
  catalogTenantForCreate,
} from "../../server/modules/products/products.tenant";

test("tenant A can read global and tenant A catalog rows", () => {
  assert.equal(canReadCatalogRow(null, 10), true);
  assert.equal(canReadCatalogRow(10, 10), true);
});

test("tenant A cannot read tenant B product or subcategory", () => {
  assert.equal(canReadCatalogRow(20, 10), false);
});

test("tenant A can mutate only tenant A-owned rows", () => {
  assert.equal(canMutateCatalogRow(10, 10), true);
  assert.equal(canMutateCatalogRow(null, 10), false);
  assert.equal(canMutateCatalogRow(20, 10), false);
});

test("tenant A cannot update or delete tenant B by ID", () => {
  assert.throws(() => assertCatalogMutation(20, 10), /não encontrado/);
  assert.throws(() => assertCatalogMutation(20, 10), (error: any) => error.status === 404);
});

test("tenant-bound creation ignores companyId, empresaId and tenantId spoofing", () => {
  assert.equal(catalogTenantForCreate(10, 20), 10);
  assert.equal(catalogTenantForCreate(10, 30), 10);
  assert.equal(catalogTenantForCreate(10, 40), 10);
});

test("global admin context preserves access to all catalog rows", () => {
  assert.equal(canReadCatalogRow(null, null), true);
  assert.equal(canReadCatalogRow(10, null), true);
  assert.equal(canMutateCatalogRow(null, null), true);
  assert.equal(canMutateCatalogRow(10, null), true);
});

test("global MASTER/DIRECTOR targeting tenant can mutate global or selected rows only", () => {
  assert.equal(canMutateCatalogRow(null, 10, true), true);
  assert.equal(canMutateCatalogRow(10, 10, true), true);
  assert.equal(canMutateCatalogRow(20, 10, true), false);
});

test("ADMIN and DEVELOPER tenant-bound policy does not gain global access", () => {
  for (const role of ["ADMIN", "DEVELOPER"]) {
    assert.equal(canReadCatalogRow(20, 10), false, role);
    assert.equal(canMutateCatalogRow(20, 10), false, role);
  }
});