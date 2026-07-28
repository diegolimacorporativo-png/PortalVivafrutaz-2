import { ConflictError, BadRequestError } from "../../shared/errors/AppError";
import { productionRepository } from "./production.repository";
import type {
  OrderBreakdownEntry,
  RouteBreakdownEntry,
  BatchWithItems,
} from "./production.repository";
import type { GenerateBatchBody } from "./production.validation";

/**
 * Valid status transitions for a production batch.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDENTE:     ["EM_PRODUCAO"],
  EM_PRODUCAO:  ["CONFERIDO", "PENDENTE"],
  CONFERIDO:    ["FINALIZADO", "EM_PRODUCAO"],
  FINALIZADO:   [],
};

export const productionService = {
  /**
   * Generate a daily production batch from orders with the given delivery date.
   * Fails if a batch for this date + empresaId already exists.
   */
  async generateBatch(
    empresaId: number | null,
    body: GenerateBatchBody,
  ): Promise<BatchWithItems> {
    const { productionDate, includeStatuses } = body;

    // Guard: no duplicate batches per day
    const existing = await productionRepository.findByDateAndEmpresa(
      empresaId,
      productionDate,
    );
    if (existing) {
      throw new ConflictError(
        `Já existe um lote de produção para ${productionDate}. Exclua-o antes de gerar novamente.`,
      );
    }

    // Fetch raw order items for the date
    const rawItems = await productionRepository.getRawOrderItemsForDate(
      empresaId,
      productionDate,
      includeStatuses,
    );

    if (rawItems.length === 0) {
      throw new BadRequestError(
        `Nenhum pedido encontrado para ${productionDate} com os status selecionados.`,
      );
    }

    // Fetch logistics routes for the date (to build route breakdown)
    const routes = await productionRepository.getRoutesForDate(
      empresaId,
      productionDate,
    );

    // Build a map: companyId → routeId + routeName
    const companyRouteMap = new Map<number, { routeId: number; routeName: string }>();
    for (const route of routes) {
      for (const cid of route.companyIds) {
        companyRouteMap.set(cid, { routeId: route.id, routeName: route.name });
      }
    }

    // Aggregate items by product
    const productMap = new Map<
      number,
      {
        productId: number;
        productName: string;
        category: string | null;
        unit: string;
        totalQuantity: number;
        orders: Map<number, OrderBreakdownEntry>;
      }
    >();

    for (const row of rawItems) {
      if (!productMap.has(row.productId)) {
        productMap.set(row.productId, {
          productId: row.productId,
          productName: row.productName,
          category: row.category,
          unit: row.unit ?? "un",
          totalQuantity: 0,
          orders: new Map(),
        });
      }
      const entry = productMap.get(row.productId)!;
      entry.totalQuantity += row.quantity;

      // Order breakdown — merge duplicate orders (same orderId, same product)
      const existing = entry.orders.get(row.orderId);
      if (existing) {
        existing.quantity += row.quantity;
      } else {
        entry.orders.set(row.orderId, {
          orderId: row.orderId,
          orderCode: row.orderCode ?? `#${row.orderId}`,
          companyId: row.companyId,
          companyName: row.companyName,
          quantity: row.quantity,
        });
      }
    }

    // Build items with route breakdown
    const itemsData = Array.from(productMap.values()).map((entry) => {
      const orderBreakdown: OrderBreakdownEntry[] = Array.from(
        entry.orders.values(),
      ).sort((a, b) => a.companyName.localeCompare(b.companyName));

      // Build route breakdown: group companies by route
      const routeMap = new Map<
        string, // "routeId" or "sem-rota"
        {
          routeId: number | null;
          routeName: string;
          quantity: number;
          companies: Map<number, { companyId: number; companyName: string; quantity: number }>;
        }
      >();

      for (const orderEntry of orderBreakdown) {
        const routeInfo = companyRouteMap.get(orderEntry.companyId);
        const key = routeInfo ? String(routeInfo.routeId) : "sem-rota";
        if (!routeMap.has(key)) {
          routeMap.set(key, {
            routeId: routeInfo?.routeId ?? null,
            routeName: routeInfo?.routeName ?? "Sem Rota",
            quantity: 0,
            companies: new Map(),
          });
        }
        const routeEntry = routeMap.get(key)!;
        routeEntry.quantity += orderEntry.quantity;

        const companyEntry = routeEntry.companies.get(orderEntry.companyId);
        if (companyEntry) {
          companyEntry.quantity += orderEntry.quantity;
        } else {
          routeEntry.companies.set(orderEntry.companyId, {
            companyId: orderEntry.companyId,
            companyName: orderEntry.companyName,
            quantity: orderEntry.quantity,
          });
        }
      }

      const routeBreakdown: RouteBreakdownEntry[] = Array.from(
        routeMap.values(),
      )
        .map((r) => ({
          routeId: r.routeId,
          routeName: r.routeName,
          quantity: r.quantity,
          companies: Array.from(r.companies.values()).sort((a, b) =>
            a.companyName.localeCompare(b.companyName),
          ),
        }))
        .sort((a, b) => a.routeName.localeCompare(b.routeName));

      return {
        productId: entry.productId,
        productName: entry.productName,
        category: entry.category,
        unit: entry.unit,
        totalQuantity: entry.totalQuantity,
        orderBreakdown,
        routeBreakdown,
      };
    });

    // Sort by category then product name
    itemsData.sort((a, b) => {
      const catA = a.category ?? "z";
      const catB = b.category ?? "z";
      if (catA !== catB) return catA.localeCompare(catB);
      return a.productName.localeCompare(b.productName);
    });

    return productionRepository.createBatch(
      {
        empresaId,
        productionDate,
        status: "PENDENTE",
        generatedAt: new Date(),
      },
      itemsData,
    );
  },

  async list(
    empresaId: number | null,
    opts: { status?: string; date?: string; page: number; limit: number },
  ) {
    return productionRepository.list(empresaId, opts);
  },

  async getById(id: number) {
    return productionRepository.getById(id);
  },

  async updateStatus(
    id: number,
    newStatus: string,
    notes?: string,
  ) {
    const batch = await productionRepository.getById(id);
    const allowed = ALLOWED_TRANSITIONS[batch.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestError(
        `Transição inválida: ${batch.status} → ${newStatus}. Permitidas: ${allowed.join(", ") || "nenhuma"}`,
      );
    }
    return productionRepository.updateStatus(id, newStatus, notes);
  },

  async updateItemCheck(
    itemId: number,
    checkedQuantity: number,
    notes?: string,
  ) {
    return productionRepository.updateItemCheck(itemId, checkedQuantity, notes);
  },

  async deleteBatch(id: number) {
    await productionRepository.getById(id); // throws NotFoundError if missing
    await productionRepository.deleteBatch(id);
  },
};
