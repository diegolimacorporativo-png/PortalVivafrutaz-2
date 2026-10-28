export interface CompanyPricingConfig {
  adminFee?: number | string | null;
  useNewPricing?: boolean | null;
}

/** Resolve submitted order prices when the company has a fee or opted into
 * the legacy full pricing rollout. A company fee is always authoritative. */
export function shouldResolveCompanyPricing(
  company: CompanyPricingConfig | null | undefined,
): boolean {
  const fee = Number(company?.adminFee ?? 0);
  return company?.useNewPricing === true || (Number.isFinite(fee) && fee > 0);
}
