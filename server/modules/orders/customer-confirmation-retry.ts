import { OrderStatus } from "./orders.workflow";

export type PendingCustomerOrder = {
  id: number;
  companyId: number;
  workflowStatus: string;
  [key: string]: any;
};

export interface CustomerConfirmationRetryPorts {
  list(limit: number): Promise<PendingCustomerOrder[]>;
  getCompany(companyId: number): Promise<any>;
  release(order: PendingCustomerOrder, company: any): Promise<void>;
  onFailure?(orderId: number, error: unknown): void;
}

/**
 * Shared retry orchestration. The storage adapter must select only durable
 * CUSTOMER_CONFIRMED rows; release must use the normal workflow transaction.
 */
export async function retryCustomerConfirmations(
  ports: CustomerConfirmationRetryPorts,
  limit = 25,
): Promise<{ scanned: number; released: number; skipped: number; failed: number }> {
  const pending = await ports.list(limit);
  let released = 0;
  let skipped = 0;
  let failed = 0;

  for (const order of pending) {
    if (order.workflowStatus !== OrderStatus.CUSTOMER_CONFIRMED) {
      skipped++;
      continue;
    }
    try {
      const company = await ports.getCompany(order.companyId);
      if (!company || !company.active || company.isLocked) {
        skipped++;
        continue;
      }
      await ports.release(order, company);
      released++;
    } catch (error: any) {
      if (error?.status === 409) {
        skipped++;
        continue;
      }
      failed++;
      ports.onFailure?.(order.id, error);
    }
  }

  return { scanned: pending.length, released, skipped, failed };
}
