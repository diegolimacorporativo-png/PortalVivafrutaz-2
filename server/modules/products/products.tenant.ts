/**
 * Tenant policy for the hybrid catalog.
 *
 * Products, categories and subcategories may be global (empresaId = null) or
 * tenant-owned. A tenant-bound request can read global rows plus its own rows,
 * but it can mutate only rows owned by that tenant. A null request tenant is
 * the existing cross-tenant/global-admin or background-job context.
 */

export function catalogTenantForCreate(
  currentTenant: number | null,
  _requestedTenant?: number | null,
): number | null {
  return currentTenant;
}

export function canReadCatalogRow(
  resourceTenant: number | null | undefined,
  currentTenant: number | null,
): boolean {
  return currentTenant == null || resourceTenant == null || resourceTenant === currentTenant;
}

export function canMutateCatalogRow(
  resourceTenant: number | null | undefined,
  currentTenant: number | null,
  allowGlobalShared = false,
): boolean {
  return currentTenant == null ||
    resourceTenant === currentTenant ||
    (allowGlobalShared && resourceTenant == null);
}

export function assertCatalogMutation(
  resourceTenant: number | null | undefined,
  currentTenant: number | null,
  allowGlobalShared = false,
): void {
  if (!canMutateCatalogRow(resourceTenant, currentTenant, allowGlobalShared)) {
    const error = new Error("Recurso não encontrado.");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }
}