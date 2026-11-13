export function uniqueDriverId(matches: readonly { id: number }[]): number | null {
  if (matches.length !== 1) return null;
  const id = Number(matches[0].id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A name-only identity can be used only inside the actor's pinned company. */
export function canUseTenantScopedNameFallback(tenantId: number | null): boolean {
  return tenantId != null && Number.isSafeInteger(Number(tenantId)) && Number(tenantId) > 0;
}
