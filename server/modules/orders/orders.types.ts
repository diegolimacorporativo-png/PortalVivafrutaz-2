/**
 * Orders module — public type contracts.
 *
 * Architecture decision: re-export the Drizzle types from `@shared/schema`
 * and add module-local DTOs (filters, response shapes). External consumers
 * (controller, other modules) import only from this barrel — never from
 * `@shared/schema` directly — so the module's surface area stays explicit.
 */
export type {
  Order,
  InsertOrder,
  OrderItem,
  InsertOrderItem,
} from "@shared/schema";

import type { Order, OrderItem } from "@shared/schema";

export interface OrdersListFilter {
  /** Optional company filter — matches the legacy `?empresaId=` query param. */
  empresaId?: number;
}

/**
 * Composite shape returned by `GET /api/orders/:id` — matches the legacy
 * payload exactly so frontend consumers continue to read `.order` / `.items`.
 */
export interface OrderDetail {
  order: Order;
  items: OrderItem[];
}
