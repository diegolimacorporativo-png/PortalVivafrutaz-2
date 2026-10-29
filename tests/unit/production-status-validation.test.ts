import assert from "node:assert/strict";
import test from "node:test";
import { generateBatchBodySchema } from "../../server/modules/production/production.validation";

test("produção aceita estados operacionais já suportados", () => {
  const parsed = generateBatchBodySchema.parse({
    productionDate: "2026-10-29",
    includeStatuses: ["CREATED", "PENDING_APPROVAL", "APPROVED", "SHIPPED"],
  });
  assert.deepEqual(parsed.includeStatuses, [
    "CREATED",
    "PENDING_APPROVAL",
    "APPROVED",
    "SHIPPED",
  ]);
});

test("produção rejeita CUSTOMER_CONFIRMED e estados desconhecidos enviados explicitamente", () => {
  for (const status of ["CUSTOMER_CONFIRMED", "NOT_A_WORKFLOW_STATUS"]) {
    assert.equal(
      generateBatchBodySchema.safeParse({
        productionDate: "2026-10-29",
        includeStatuses: [status],
      }).success,
      false,
    );
  }
});
