import { LOGISTICS_AUTH_ROLES } from "./logistics.types";

export const DELIVERY_GLOBAL_ROLES = ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"] as const;
export const DELIVERY_DRIVER_ROLES = ["DRIVER", "MOTORISTA"] as const;

export type DeliveryActor = {
  role?: string | null;
  empresaId?: number | null;
};

export function isDeliveryInternalRole(role: string | null | undefined): boolean {
  return !!role && (LOGISTICS_AUTH_ROLES as readonly string[]).includes(role);
}

export function isDeliveryDriverRole(role: string | null | undefined): boolean {
  return !!role && (DELIVERY_DRIVER_ROLES as readonly string[]).includes(role);
}

export type DeliveryAccess =
  | { allowed: true; tenantId: number | null }
  | { allowed: false; status: 403; message: string };

/**
 * Resolve the tenant allowed to operate on a delivery.
 *
 * A tenant-bound user is always pinned to its own company. Only the existing
 * global profiles may operate without a company binding.
 */
export function resolveDeliveryAccess(
  actor: DeliveryActor,
  selectedTenantId: number | null = null,
  allowMultiCompanyRead = false,
): DeliveryAccess {
  if (!isDeliveryInternalRole(actor.role) && !isDeliveryDriverRole(actor.role)) {
    return { allowed: false, status: 403, message: "Acesso negado" };
  }

  if (actor.empresaId != null) {
    const tenantId = Number(actor.empresaId);
    if (!Number.isInteger(tenantId) || tenantId <= 0 ||
      (selectedTenantId != null && selectedTenantId !== tenantId)) {
      return { allowed: false, status: 403, message: "Acesso negado" };
    }
    return { allowed: true, tenantId };
  }

  if (selectedTenantId != null) {
    if (!Number.isInteger(selectedTenantId) || selectedTenantId <= 0 || !isDeliveryInternalRole(actor.role)) {
      return { allowed: false, status: 403, message: "Acesso negado" };
    }
    return { allowed: true, tenantId: selectedTenantId };
  }

  if (!(DELIVERY_GLOBAL_ROLES as readonly string[]).includes(actor.role ?? "")) {
    if (allowMultiCompanyRead && ["LOGISTICS", "COMERCIAL"].includes(actor.role ?? "")) {
      return { allowed: true, tenantId: null };
    }
    return {
      allowed: false,
      status: 403,
      message: "Selecione uma empresa para esta operação",
    };
  }

  return { allowed: true, tenantId: null };
}

export function isDeliveryInTenant(
  delivery: { companyId?: number | null },
  tenantId: number | null,
): boolean {
  return tenantId == null || Number(delivery.companyId) === tenantId;
}

/**
 * The ownership column is controlled by the authorized context, never by a
 * tenant-bound request body. Global creation may keep the canonical companyId
 * for the existing support workflow, but aliases are never accepted.
 */
export function sanitizeDeliveryCreateBody(
  body: unknown,
  tenantId: number | null,
): Record<string, unknown> {
  const safe = asRecord(body);
  delete safe.empresaId;
  delete safe.empresa_id;
  delete safe.company_id;
  delete safe.tenantId;
  delete safe.tenant_id;

  if (tenantId != null) {
    safe.companyId = tenantId;
  }

  return safe;
}

export type DeliveryOrderLinkCheck =
  | { valid: true; orderId: number | null }
  | { valid: false; status: 400 | 404; message: string };

/** Validate an optional order link without restricting additional deliveries. */
export async function validateDeliveryOrderLink(
  value: unknown,
  authorizedCompanyId: number,
  findOrder: (orderId: number) => Promise<{ companyId?: number | null } | null | undefined>,
): Promise<DeliveryOrderLinkCheck> {
  if (value == null || value === "") return { valid: true, orderId: null };

  const orderId = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    return { valid: false, status: 400, message: "Pedido vinculado inválido" };
  }

  const order = await findOrder(orderId);
  // Use the same response for missing and cross-company IDs to avoid disclosing
  // whether another tenant's order exists.
  if (!order || Number(order.companyId) !== authorizedCompanyId) {
    return { valid: false, status: 404, message: "Pedido não encontrado para a empresa selecionada" };
  }

  return { valid: true, orderId };
}

export function sanitizeDeliveryUpdateBody(
  body: unknown,
): Record<string, unknown> {
  const safe = asRecord(body);
  delete safe.companyId;
  delete safe.company_id;
  delete safe.empresaId;
  delete safe.empresa_id;
  delete safe.tenantId;
  delete safe.tenant_id;
  return safe;
}

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }
  return { ...(body as Record<string, unknown>) };
}
