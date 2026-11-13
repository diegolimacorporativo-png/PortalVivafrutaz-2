import type { NextFunction, Request, Response } from "express";
import { ServiceUnavailableError } from "../../shared/errors/AppError";

/** Temporary safety lock while the operational workflow is decoupled from invoicing. */
export const NFE_ISSUANCE_PAUSED = true;
export const NFE_ISSUANCE_PAUSED_MESSAGE =
  "A emissão fiscal está temporariamente suspensa durante a atualização do fluxo operacional.";

export function assertNfeIssuanceEnabled(): void {
  if (NFE_ISSUANCE_PAUSED) throw new ServiceUnavailableError(NFE_ISSUANCE_PAUSED_MESSAGE);
}

/** Blocks every write to fiscal workflow state while the global pause is active. */
export function assertFiscalMutationEnabled(): void {
  assertNfeIssuanceEnabled();
}

/** HTTP guard for routes that preview, generate, transmit, or recover NF-e. */
export function blockNfeIssuance(_req: Request, res: Response, next: NextFunction): void {
  if (NFE_ISSUANCE_PAUSED) {
    res.status(503).json({
      success: false,
      code: "NFE_ISSUANCE_PAUSED",
      message: NFE_ISSUANCE_PAUSED_MESSAGE,
    });
    return;
  }
  next();
}
