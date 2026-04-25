import { NotFoundError } from "../../core/errors/AppError";
import { ordersRepository, OrdersRepository } from "./orders.repository";
import type { Order, OrderDetail, OrdersListFilter } from "./orders.types";

/**
 * OrdersService — business rules of the orders module.
 *
 * Architecture decision: services own *behavior*. They orchestrate the
 * repository, enforce invariants, and never touch req/res. This keeps the
 * module reusable from a CLI, a worker, or another module — not just HTTP.
 *
 * Scope (this iteration): READ paths only. Mutations and side-effecting
 * workflows (create / update / cancel / reopen / fiscal export / push +
 * email notifications / auto-logistics) deliberately remain in the legacy
 * `server/routes/routes.ts` for now and will be migrated in a follow-up.
 */
export class OrdersService {
  constructor(private readonly repo: OrdersRepository = ordersRepository) {}

  list(filter: OrdersListFilter = {}): Promise<Order[]> {
    return this.repo.list(filter);
  }

  async get(id: number): Promise<OrderDetail> {
    const detail = await this.repo.get(id);
    if (!detail) throw new NotFoundError("Pedido não encontrado");
    return detail;
  }

  listByCompany(companyId: number): Promise<Order[]> {
    return this.repo.listByCompany(companyId);
  }
}

export const ordersService = new OrdersService();
