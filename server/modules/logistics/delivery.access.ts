export const DELIVERY_GLOBAL_ROLES = ["MASTER", "DIRECTOR"] as const;

export type DeliveryActor = {
  role?: string | null;
  empresaId?: number | null;
};

export type DeliveryAccess =
  | { allowed: true; tenantId: number | null }
  | { allowed: false; status: 403; message: string };

/**
 * Resolve the tenant allowed to operate on a delivery.
 *
 * A tenant-bound user is always pinned to its own company. Only the existing
 * global profiles may operate without a company binding.
 */
export function resolveDeliveryAccess(actor: DeliveryActor): DeliveryAccess {
  if (!actor.role) {
    return { allowed: false, status: 403, message: "Acesso negado" };
  }

  if (actor.empresaId != null) {
    const tenantId = Number(actor.empresaId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return { allowed: false, status: 403, message: "Acesso negado" };
    }
    return { allowed: true, tenantId };
  }

  if (
    !(DELIVERY_GLOBAL_ROLES as readonly string[]).includes(actor.role)
  ) {
    return {
      allowed: false,
      status: 403,
      message: "Este perfil precisa estar vinculado a uma empresa",
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