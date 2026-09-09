import {
  canMutateCatalogRow,
  canReadCatalogRow,
  catalogTenantForCreate,
} from "./products.tenant";

/**
 * Price rows are visible only when the row itself, its product and its group
 * are each global or owned by the current tenant.
 */
export function canReadPricingChain(
  priceTenant: number | null | undefined,
  productTenant: number | null | undefined,
  groupTenant: number | null | undefined,
  currentTenant: number | null,
): boolean {
  return canReadCatalogRow(priceTenant, currentTenant)
    && canReadCatalogRow(productTenant, currentTenant)
    && canReadCatalogRow(groupTenant, currentTenant);
}

/**
 * A price mutation must not cross the ownership boundary of any referenced
 * resource. Global shared rows are mutable only when the caller explicitly
 * has the global-catalog privilege.
 */
export function canMutatePricingChain(
  priceTenant: number | null | undefined,
  productTenant: number | null | undefined,
  groupTenant: number | null | undefined,
  currentTenant: number | null,
  allowGlobalShared = false,
): boolean {
  return canMutateCatalogRow(priceTenant, currentTenant, allowGlobalShared)
    && canMutateCatalogRow(productTenant, currentTenant, allowGlobalShared)
    && canMutateCatalogRow(groupTenant, currentTenant, allowGlobalShared);
}

export function pricingTenantForCreate(
  currentTenant: number | null,
  requestedTenant?: number | null,
): number | null {
  return catalogTenantForCreate(currentTenant, requestedTenant);
}