import assert from "node:assert/strict";
import { test } from "node:test";
import { isManualCatalogSelectionCompatible } from "../../server/modules/production/manual-catalog-scope.policy";

test("allows a company-owned product and its company-owned subcategory", () => {
  assert.equal(isManualCatalogSelectionCompatible({
    companyId: 10,
    productId: 100,
    productCompanyId: 10,
    subcategory: { productId: 100, companyId: 10 },
  }), true);
});

test("allows a global product and a global subcategory for a company", () => {
  assert.equal(isManualCatalogSelectionCompatible({
    companyId: 10,
    productId: 100,
    productCompanyId: null,
    subcategory: { productId: 100, companyId: null },
  }), true);
});

test("rejects a product owned by another company", () => {
  assert.equal(isManualCatalogSelectionCompatible({
    companyId: 10,
    productId: 100,
    productCompanyId: 20,
  }), false);
});

test("rejects a subcategory owned by another company or attached to another product", () => {
  assert.equal(isManualCatalogSelectionCompatible({
    companyId: 10,
    productId: 100,
    productCompanyId: null,
    subcategory: { productId: 100, companyId: 20 },
  }), false);
  assert.equal(isManualCatalogSelectionCompatible({
    companyId: 10,
    productId: 100,
    productCompanyId: null,
    subcategory: { productId: 101, companyId: null },
  }), false);
});
