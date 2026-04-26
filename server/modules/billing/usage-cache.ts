/**
 * Cache de uso/limites de plano por empresa.
 *
 * Vive em arquivo próprio (sem importar `storage`) para que o storage layer
 * possa invalidar o cache após inserts sem criar ciclo de imports.
 */

export interface CachedUsageEntry<T = any> {
  data: T;
  timestamp: number;
}

export const USAGE_CACHE_TTL_MS = 30_000;

const usageCache = new Map<number, CachedUsageEntry>();

export function getCachedUsage<T = any>(companyId: number): T | undefined {
  const entry = usageCache.get(companyId);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp >= USAGE_CACHE_TTL_MS) {
    usageCache.delete(companyId);
    return undefined;
  }
  return entry.data as T;
}

export function setCachedUsage<T = any>(companyId: number, data: T): void {
  usageCache.set(companyId, { data, timestamp: Date.now() });
}

export function invalidateUsageCache(companyId?: number | null): void {
  if (companyId === null || companyId === undefined) {
    usageCache.clear();
    return;
  }
  usageCache.delete(Number(companyId));
}
