import assert from "node:assert/strict";
import test from "node:test";
import { isProductionOrderEligible } from "../../server/modules/production/production-eligibility";

test("pedido livre só entra em APPROVED", () => {
  assert.equal(isProductionOrderEligible({ origin: "FREE", workflowStatus: "APPROVED" }), true);
  for (const workflowStatus of ["CREATED", "CUSTOMER_CONFIRMED", "PENDING_APPROVAL", "PROCESSING", "READY", "INVOICED", "SHIPPED", "DELIVERED", "CANCELLED", "REJECTED"]) {
    assert.equal(isProductionOrderEligible({ origin: "FREE", workflowStatus }), false, workflowStatus);
  }
});

test("PENDING_APPROVAL só é elegível para ocorrência contratual comprovada", () => {
  assert.equal(isProductionOrderEligible({ origin: "CONTRACT_FIXED", workflowStatus: "PENDING_APPROVAL", contractOccurrenceValid: true }), true);
  assert.equal(isProductionOrderEligible({ origin: "CONTRACT_FIXED", workflowStatus: "PENDING_APPROVAL", contractOccurrenceValid: false }), false);
  assert.equal(isProductionOrderEligible({ origin: "CONTRACT_FIXED", workflowStatus: "PENDING_APPROVAL" }), false);
  assert.equal(isProductionOrderEligible({ origin: null, workflowStatus: "PENDING_APPROVAL", contractOccurrenceValid: true }), false);
});

test("isRecurring ou origem ausente não comprovam contrato", () => {
  assert.equal(isProductionOrderEligible({ origin: null, workflowStatus: "APPROVED" }), false);
});

test("pedido pontual exige aprovação e vínculo materializado aprovado", () => {
  assert.equal(isProductionOrderEligible({ origin: "SPECIAL", workflowStatus: "APPROVED", specialRequestApprovedAndMaterialized: true }), true);
  assert.equal(isProductionOrderEligible({ origin: "SPECIAL", workflowStatus: "PENDING_APPROVAL", specialRequestApprovedAndMaterialized: true }), false);
  assert.equal(isProductionOrderEligible({ origin: "SPECIAL", workflowStatus: "APPROVED", specialRequestApprovedAndMaterialized: false }), false);
});
