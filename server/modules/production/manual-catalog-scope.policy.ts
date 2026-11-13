export interface ManualCatalogSubcategoryScope {
  productId: number;
  companyId: number | null;
}

/** Global catalog rows are usable by every company; tenant rows only by their owner. */
export function isCatalogRowAvailableToCompany(
  catalogCompanyId: number | null | undefined,
  companyId: number,
): boolean {
  return Number.isSafeInteger(companyId) && companyId > 0 &&
    (catalogCompanyId == null || Number(catalogCompanyId) === companyId);
}

export function isManualCatalogSelectionCompatible(input: {
  companyId: number;
  productId: number;
  productCompanyId: number | null;
  subcategory?: ManualCatalogSubcategoryScope | null;
}): boolean {
  if (!isCatalogRowAvailableToCompany(input.productCompanyId, input.companyId)) return false;
  if (!input.subcategory) return true;
  return input.subcategory.productId === input.productId &&
    isCatalogRowAvailableToCompany(input.subcategory.companyId, input.companyId);
}
