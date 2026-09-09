/**
 * Price and price-group tenant policy tests.
 *
 * These tests are deliberately pure: they do not connect to or mutate the
 * development or production database.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  canMutatePricingChain,
  canReadPricingChain,
  pricingTenantForCreate,
} from "../../server/modules/products/pricing.tenant";

test("tenant A can read a global price chain and its own chain", () => {
  assert.equal(canReadPricingChain(null, null, null, 10), true);
  assert.equal(canReadPricingChain(10, 10, null, 10), true);
});

test("tenant A cannot read a price chain containing tenant B data", () => {
  assert.equal(canReadPricingChain(10, 20, 10, 10), false);
  assert.equal(canReadPricingChain(null, null, 20, 10), false);
  assert.equal(canReadPricingChain(20, null, null, 10), false);
});

test("tenant-bound price creation cannot be redirected by a requested tenant", () => {
  assert.equal(pricingTenantForCreate(10, 20), 10);
  assert.equal(pricingTenantForCreate(10, null), 10);
});

test("tenant A can mutate only its own complete price chain", () => {
  assert.equal(canMutatePricingChain(10, 10, 10, 10), true);
  assert.equal(canMutatePricingChain(null, 10, 10, 10), false);
  assert.equal(canMutatePricingChain(10, 20, 10, 10), false);
  assert.equal(canMutatePricingChain(10, 10, 20, 10), false);
});

test("global catalog privilege is explicit when targeting a tenant", () => {
  assert.equal(canMutatePricingChain(null, null, null, 10, true), true);
  assert.equal(canMutatePricingChain(10, 10, null, 10, true), true);
  assert.equal(canMutatePricingChain(10, 20, 10, 10, true), false);
});