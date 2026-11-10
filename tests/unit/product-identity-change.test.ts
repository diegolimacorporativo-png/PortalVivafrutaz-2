import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveProductCodeForEdit, shouldCheckProductCode, shouldCheckProductIdentity } from "../../client/src/pages/admin/products/dialogs/product-identity-change";

test("editing without changing name or base ID skips duplicate checks", () => {
  assert.equal(shouldCheckProductIdentity(
    { name: "Pêssego Nacional (início safra)", productCode: "PES-01" },
    { name: "Pêssego Nacional (início safra)", productCode: "PES-01" },
  ), false);
});

test("editing another field while the legacy base ID is blank remains possible", () => {
  assert.equal(shouldCheckProductIdentity(
    { name: "Pêssego Nacional (início safra)", productCode: "" },
    { name: "Pêssego Nacional (início safra)", productCode: null },
  ), false);
});

test("changing the name or base ID runs duplicate validation", () => {
  const original = { name: "Pêssego", productCode: "PES-01" };
  assert.equal(shouldCheckProductIdentity({ ...original, name: "Pêssego Nacional" }, original), true);
  assert.equal(shouldCheckProductIdentity({ ...original, productCode: "PES-02" }, original), true);
});

test("new products always run duplicate validation", () => {
  assert.equal(shouldCheckProductIdentity({ name: "Pêssego", productCode: "PES-01" }, null), true);
});

test("the unchanged base ID is not rejected during edit, but a changed ID is checked", () => {
  assert.equal(shouldCheckProductCode(" PES-01 ", "PES-01"), false);
  assert.equal(shouldCheckProductCode("PES-02", "PES-01"), true);
});

test("edit keeps the persisted base ID instead of a generated replacement", () => {
  assert.equal(resolveProductCodeForEdit("  PES-001 ", "NEXT-999"), "PES-001");
});

test("edit fills a missing legacy base ID with the generated value", () => {
  assert.equal(resolveProductCodeForEdit(null, "NEXT-999"), "NEXT-999");
});
