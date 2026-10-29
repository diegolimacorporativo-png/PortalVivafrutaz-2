import assert from "node:assert/strict";
import test from "node:test";
import { customerOrderIntentMatches } from "../../server/modules/orders/order-confirmation";

const order = {
  deliveryDate: "2026-11-04T12:00:00.000Z",
  weekReference: "2026-W45",
  deliveryAddressId: 17,
  orderNote: "Entregar na recepção",
};
const items = [
  { productId: 4, subCategoryId: 2, quantity: 3, unitPrice: "10.00" },
  { productId: 8, quantity: 1, unitPrice: "4.00" },
];

test("retry comparison accepts same customer intent despite item order and refreshed pricing", () => {
  assert.equal(customerOrderIntentMatches(
    order,
    [{ ...items[1], unitPrice: "4.50" }, { ...items[0], unitPrice: "11.00" }],
    order,
    items,
  ), true);
});

test("retry comparison rejects a different day, delivery address, note or item quantity", () => {
  assert.equal(customerOrderIntentMatches(order, items, { ...order, deliveryDate: "2026-11-05T12:00:00Z" }, items), false);
  assert.equal(customerOrderIntentMatches(order, items, { ...order, deliveryAddressId: 18 }, items), false);
  assert.equal(customerOrderIntentMatches(order, items, { ...order, orderNote: "Outra instrução" }, items), false);
  assert.equal(customerOrderIntentMatches(order, items, order, [{ ...items[0], quantity: 5 }, items[1]]), false);
});
