import {
  LOGISTICS_AUTH_ROLES,
  type ActorRef,
} from "./logistics.types";

export type NumericRouteTrackingAccess =
  | { global: true; empresaId: null }
  | { global: false; empresaId: number };

/**
 * Numeric route ids are only a compatibility path for authenticated
 * operational users. Tenant-bound actors must be constrained by empresa_id;
 * only explicitly global MASTER/DIRECTOR actors may read across tenants.
 */
export function resolveNumericRouteTrackingAccess(
  actor: ActorRef | null | undefined,
): NumericRouteTrackingAccess | null {
  if (!actor) return null;

  const isInternal =
    (LOGISTICS_AUTH_ROLES as readonly string[]).includes(actor.role);
  const isDriver = actor.role === "DRIVER" || actor.role === "MOTORISTA";
  if (!isInternal && !isDriver) return null;

  if (actor.empresaId != null) {
    return { global: false, empresaId: actor.empresaId };
  }

  if (actor.role === "MASTER" || actor.role === "DIRECTOR") {
    return { global: true, empresaId: null };
  }

  return null;
}
