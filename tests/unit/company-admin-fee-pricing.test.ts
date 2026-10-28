import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePrice } from "../../client/src/utils/priceResolver";
import { shouldResolveCompanyPricing } from "../../server/modules/orders/companyPricing";
import { OrdersService } from "../../server/modules/orders/orders.service";

test("taxa administrativa é aplicada ao preço exibido sem habilitar a flag legada", () => {
  assert.equal(resolvePrice({ basePrice: 10, adminFee: 18, useNewPricing: false }), 11.8);
});

test("taxa administrativa é aplicada sobre o preço negociado, sem alterar preço-base", () => {
  assert.equal(resolvePrice({ basePrice: 10, contractPrice: 20, adminFee: 18 }), 23.6);
  assert.equal(resolvePrice({ basePrice: 10, adminFee: 0, useNewPricing: false }), 10);
});

test("reprecificação no servidor é ativada por taxa configurada mesmo com flag legada desligada", () => {
  assert.equal(shouldResolveCompanyPricing({ adminFee: "18.00", useNewPricing: false }), true);
  assert.equal(shouldResolveCompanyPricing({ adminFee: 0, useNewPricing: false }), false);
  assert.equal(shouldResolveCompanyPricing({ adminFee: 0, useNewPricing: true }), true);
});

test("pipeline do pedido recalcula no servidor e ignora preço enviado pelo navegador", async () => {
  const repository = {
    getCompany: async () => ({ id: 9, adminFee: "18.00", useNewPricing: false, priceGroupId: 2 }),
    getProductById: async () => ({ id: 4, basePrice: "10.00" }),
    getProductSubCategoryById: async () => null,
    getContractScope: async () => null,
    getPriceGroupPrice: async () => ({ price: "15.00" }),
  };
  const service = new OrdersService(repository as any);
  const submitted = [{ productId: 4, quantity: 2, unitPrice: "1.00", totalPrice: "2.00" }];

  const resolved = await (service as any).resolveCompanyOrderItems(9, submitted);

  assert.deepEqual(resolved[0], {
    productId: 4,
    quantity: 2,
    unitPrice: "17.70",
    totalPrice: "35.40",
  });
  assert.equal(submitted[0].unitPrice, "1.00", "o item recebido permanece imutável");
});
