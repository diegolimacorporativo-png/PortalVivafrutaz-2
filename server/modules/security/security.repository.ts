/**
 * FASE 6.1 — Security Audit Repository
 *
 * Read-only repository for security audit data, focused on tenant
 * mismatch events. This is a placeholder implementation that returns
 * safe aggregated data only — no real log scanning or DB access yet.
 *
 * Future evolution:
 *  - Read from `[SECURITY] TENANT_MISMATCH` log file/stream
 *  - Persist events to a dedicated `security_events` table
 *  - Group by tenant / user / time window
 *
 * GUARANTEES (intentional):
 *  - Never returns real orderId values, tenantIds or order payloads
 *  - Only aggregates (counts) are exposed
 *  - Pure function, no side effects, no DB queries
 */
export async function getTenantMismatchEvents(
  days: number,
): Promise<{
  total: number;
  byOrder: Record<string, number>;
  windowDays: number;
}> {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 7;

  return {
    total: 0,
    byOrder: {},
    windowDays: safeDays,
  };
}
