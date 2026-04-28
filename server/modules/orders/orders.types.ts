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
 * FASE FIN.2 — Projeção de pagamento derivada de `accounts_receivable`.
 *
 * Campos somente-leitura. NÃO existem em `orders` no banco — são calculados
 * em runtime a partir do AR vinculado pelo `orderId`. Sempre seguros: em
 * caso de erro/AR ausente, retornam `{ isPaid: false, paidAt: null }`.
 */
export interface OrderPaymentProjection {
  isPaid: boolean;
  paidAt: Date | null;
}

/**
 * FASE FIN.2 — Pedido + projeção de pagamento.
 *
 * Tipo de retorno das listagens de pedido após enriquecimento com a
 * projeção financeira. NÃO substitui `Order`; apenas estende.
 */
export type OrderWithPayment = Order & OrderPaymentProjection;

/**
 * Composite shape returned by `GET /api/orders/:id` — matches the legacy
 * payload exactly so frontend consumers continue to read `.order` / `.items`.
 *
 * FASE FIN.2 — campos `isPaid` e `paidAt` adicionados como **opcionais**
 * para preservar 100% dos consumidores legados (TypeScript). Em runtime,
 * `OrdersService.get()` sempre os preenche.
 */
export interface OrderDetail {
  order: Order;
  items: OrderItem[];
  isPaid?: boolean;
  paidAt?: Date | null;
}
