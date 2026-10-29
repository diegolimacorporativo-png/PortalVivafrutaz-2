import assert from "node:assert/strict";
import test from "node:test";
import {
  isDeliveryInternalRole,
  resolveDeliveryAccess,
  validateDeliveryOrderLink,
} from "../../server/modules/logistics/delivery.access";

test("manual delivery permits a valid order from the selected company", async () => {
  const result = await validateDeliveryOrderLink(41, 7, async (id) => ({
    companyId: id === 41 ? 7 : 8,
  }));

  assert.deepEqual(result, { valid: true, orderId: 41 });
});

test("manual delivery hides an order belonging to another company", async () => {
  const result = await validateDeliveryOrderLink("41", 7, async () => ({ companyId: 8 }));

  assert.deepEqual(result, {
    valid: false,
    status: 404,
    message: "Pedido não encontrado para a empresa selecionada",
  });
});

test("manual delivery rejects nonexistent or malformed order links", async () => {
  const missing = await validateDeliveryOrderLink(41, 7, async () => null);
  const malformed = await validateDeliveryOrderLink("not-an-id", 7, async () => null);

  assert.equal(missing.valid, false);
  if (!missing.valid) assert.equal(missing.status, 404);
  assert.deepEqual(malformed, {
    valid: false,
    status: 400,
    message: "Pedido vinculado inválido",
  });
});

test("manual ad-hoc and additional deliveries remain valid", async () => {
  let lookupCount = 0;
  const adHoc = await validateDeliveryOrderLink(undefined, 7, async () => {
    lookupCount += 1;
    return null;
  });
  const linkedAgain = await validateDeliveryOrderLink(41, 7, async () => ({ companyId: 7 }));

  assert.deepEqual(adHoc, { valid: true, orderId: null });
  assert.deepEqual(linkedAgain, { valid: true, orderId: 41 });
  assert.equal(lookupCount, 0);
});

test("unauthorized actors are rejected before the manual delivery operation", () => {
  assert.equal(isDeliveryInternalRole("CLIENT"), false);
  assert.deepEqual(resolveDeliveryAccess({ role: "CLIENT", empresaId: 7 }, 7), {
    allowed: false,
    status: 403,
    message: "Acesso negado",
  });
});
