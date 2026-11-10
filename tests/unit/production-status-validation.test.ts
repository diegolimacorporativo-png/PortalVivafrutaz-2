import assert from "node:assert/strict";
import test from "node:test";
import { generateBatchBodySchema } from "../../server/modules/production/production.validation";

test("produção não permite ao cliente escolher statuses de entrada", () => {
  const parsed = generateBatchBodySchema.parse({
    productionDate: "2026-10-29",
    previewFingerprint: "a".repeat(64),
    includeStatuses: ["CREATED", "PENDING_APPROVAL", "APPROVED", "SHIPPED"],
  });
  assert.deepEqual(parsed, { productionDate: "2026-10-29", previewFingerprint: "a".repeat(64) });
});

test("status fora da matriz não altera os filtros efetivos de produção", () => {
  for (const status of ["CUSTOMER_CONFIRMED", "NOT_A_WORKFLOW_STATUS"]) {
    const parsed = generateBatchBodySchema.parse({
      productionDate: "2026-10-29",
      previewFingerprint: "b".repeat(64),
      includeStatuses: [status],
    });
    assert.deepEqual(parsed, { productionDate: "2026-10-29", previewFingerprint: "b".repeat(64) });
  }
});

test("geração exige fingerprint válido e data de calendário real", () => {
  const fingerprint = "c".repeat(64);
  assert.equal(generateBatchBodySchema.safeParse({ productionDate: "2026-11-05", previewFingerprint: fingerprint }).success, true);
  assert.equal(generateBatchBodySchema.safeParse({ productionDate: "2026-11-05", previewFingerprint: "invalid" }).success, false);
  assert.equal(generateBatchBodySchema.safeParse({ productionDate: "2026-02-30", previewFingerprint: fingerprint }).success, false);
  assert.equal(generateBatchBodySchema.safeParse({ productionDate: "2026-11-05" }).success, false);
});
