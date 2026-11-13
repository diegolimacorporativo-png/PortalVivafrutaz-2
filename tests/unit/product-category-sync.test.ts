import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProductCategorySyncPlan } from "../../client/src/pages/admin/products/dialogs/product-category-sync.ts";

test("keeps the existing subcategory ID when its selected price changes", () => {
  const plan = buildProductCategorySyncPlan(
    [{ id: 21, categoryName: "Processados Bio", price: "8.00", active: true }],
    [{ categoryName: "Processados Bio", price: "9.50" }],
  );

  assert.deepEqual(plan, {
    update: [{ id: 21, categoryName: "Processados Bio", price: "9.5", active: true }],
    create: [],
    deactivate: [],
  });
});

test("creates only newly selected categories and deactivates removed rows without deleting IDs", () => {
  const plan = buildProductCategorySyncPlan(
    [
      { id: 21, categoryName: "In Natura", price: "4.00", active: true },
      { id: 22, categoryName: "Processados Bio", price: "8.00", active: true },
    ],
    [
      { categoryName: "In Natura", price: "4.50" },
      { categoryName: "Industrializados", price: "12.00" },
    ],
  );

  assert.deepEqual(plan, {
    update: [{ id: 21, categoryName: "In Natura", price: "4.5", active: true }],
    create: [{ categoryName: "Industrializados", price: "12" }],
    deactivate: [22],
  });
});

test("reactivates a previously inactive matching category instead of creating a duplicate", () => {
  const plan = buildProductCategorySyncPlan(
    [{ id: 31, categoryName: "Pote Bio", price: "7.00", active: false }],
    [{ categoryName: "Pote Bio", price: "7.25" }],
  );

  assert.deepEqual(plan, {
    update: [{ id: 31, categoryName: "Pote Bio", price: "7.25", active: true }],
    create: [],
    deactivate: [],
  });
});

test("leaves already inactive, unselected historical categories unchanged", () => {
  const plan = buildProductCategorySyncPlan(
    [{ id: 41, categoryName: "Categoria antiga", price: "5.00", active: false }],
    [],
  );

  assert.deepEqual(plan, { update: [], create: [], deactivate: [] });
});
