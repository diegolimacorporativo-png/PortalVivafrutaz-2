import { storage } from "../../services/storage";
import type { Order, OrderDetail, OrdersListFilter } from "./orders.types";

/**
 * OrdersRepository — the only place the orders module talks to persistence.
 *
 * Architecture decision: today every method delegates to the legacy `storage`
 * facade because it already implements the Drizzle queries used across the
 * codebase. Tomorrow, when storage is split by domain, the body of each
 * method can be swapped for direct Drizzle calls (e.g. `db.select().from(
 * orders)`) without touching the service or controller above.
 *
 * Repository = data access only. No business rules. No HTTP. No logging.
 */
export class OrdersRepository {
  /**
   * List orders, optionally scoped to a company. Mirrors the legacy
   * `storage.getOrders(empresaId?)` signature exactly.
   */
  list(filter: OrdersListFilter = {}): Promise<Order[]> {
    return storage.getOrders(filter.empresaId as number | undefined);
  }

  /** Single order with its items, or undefined if not found. */
  get(id: number): Promise<OrderDetail | undefined> {
    return storage.getOrder(id);
  }

  /** All orders belonging to a single company. */
  listByCompany(companyId: number): Promise<Order[]> {
    return storage.getCompanyOrders(companyId);
  }
}

export const ordersRepository = new OrdersRepository();
