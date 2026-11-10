export type ProductionOrderOrigin = "FREE" | "CONTRACT_FIXED" | "SPECIAL" | null;

export interface ProductionEligibilityEvidence {
  workflowStatus: string;
  origin: ProductionOrderOrigin;
  contractOccurrenceValid?: boolean;
  specialRequestApprovedAndMaterialized?: boolean;
}

/** Fail-closed eligibility gate. Contract PENDING_APPROVAL is the sole
 * exception and requires persisted, item-level occurrence evidence. */
export function isProductionOrderEligible(evidence: ProductionEligibilityEvidence): boolean {
  if (evidence.origin === "FREE") return evidence.workflowStatus === "APPROVED";
  if (evidence.origin === "SPECIAL") {
    return evidence.workflowStatus === "APPROVED" && evidence.specialRequestApprovedAndMaterialized === true;
  }
  if (evidence.origin === "CONTRACT_FIXED") {
    return (evidence.workflowStatus === "APPROVED" || evidence.workflowStatus === "PENDING_APPROVAL") &&
      evidence.contractOccurrenceValid === true;
  }
  // Legacy rows without persisted origin are never guessed from isRecurring,
  // notes, or current contract scopes.
  return false;
}
