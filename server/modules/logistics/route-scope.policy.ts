import { ConflictError } from "../../shared/errors/AppError";

export interface ActiveRouteDeliveryIdentity {
  id: number;
  companyId: number | null;
  driverId: number | null;
  deliveryDate: string | null;
}

/** Refuse route edits that would make an already assigned active delivery invalid. */
export function assertActiveDeliveriesMatchRouteScope(input: {
  deliveries: ActiveRouteDeliveryIdentity[];
  companyIds: number[];
  driverId: number | null;
  deliveryDate: string | null;
}): void {
  const allowed = new Set(input.companyIds.map(Number));
  const normalizeDate = (value: string | null) => String(value ?? "").slice(0, 10);
  const incompatible = input.deliveries.find((delivery) =>
    delivery.companyId == null || !allowed.has(Number(delivery.companyId)) ||
    Number(delivery.driverId) !== Number(input.driverId) ||
    normalizeDate(delivery.deliveryDate) !== normalizeDate(input.deliveryDate),
  );
  if (incompatible) {
    throw new ConflictError(
      "A edição deixaria entregas ativas incompatíveis com as empresas, motorista ou data da rota.",
      { deliveryId: incompatible.id },
    );
  }
}
