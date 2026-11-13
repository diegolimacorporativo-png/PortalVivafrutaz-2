import assert from "node:assert/strict";
import { test } from "node:test";
import { canUseTenantScopedNameFallback, uniqueDriverId } from "../../server/modules/logistics/driver-identity.policy";

test("accepts exactly one stable driver identity match", () => {
  assert.equal(uniqueDriverId([{ id: 41 }]), 41);
});

test("fails closed when email or name identity matches multiple drivers", () => {
  assert.equal(uniqueDriverId([{ id: 41 }, { id: 52 }]), null);
});

test("name-only fallback requires a valid company scope", () => {
  assert.equal(canUseTenantScopedNameFallback(10), true);
  assert.equal(canUseTenantScopedNameFallback(null), false);
  assert.equal(canUseTenantScopedNameFallback(0), false);
});
