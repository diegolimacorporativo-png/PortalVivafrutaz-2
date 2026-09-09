export const ORDER_EXCEPTION_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
] as const;

/**
 * MASTER and DIRECTOR are the explicitly global administrative profiles used
 * by the existing tenant-isolation policy. ADMIN remains tenant-bound when
 * linked to a company and is not promoted to global access.
 */
export const ORDER_EXCEPTION_GLOBAL_ROLES = ["MASTER", "DIRECTOR"] as const;

export type OrderExceptionActor = {
  role?: string | null;
  empresaId?: number | null;
};

export type OrderExceptionAccess =
  | { allowed: true; tenantId: number | null }
  | { allowed: false; status: 400 | 403 | 404; message: string };

/**
 * Resolve the tenant for an order-exception operation.
 *
 * For creation/listing/company-check, requestedCompanyId is optional. A
 * tenant-bound actor always wins over the request value. Global actors may
 * explicitly select a company; a global list keeps tenantId null.
 */
export function resolveOrderExceptionAccess(
  actor: OrderExceptionActor,
  requestedCompanyId?: number | null,
): OrderExceptionAccess {
  if (
    !actor.role ||
    !(ORDER_EXCEPTION_ROLES as readonly string[]).includes(actor.role)
  ) {
    return { allowed: false, status: 403, message: "Acesso negado" };
  }

  if (actor.empresaId != null) {
    const tenantId = Number(actor.empresaId);
    if (
      requestedCompanyId != null &&
      Number(requestedCompanyId) !== tenantId
    ) {
      return {
        allowed: false,
        status: 404,
        message: "Exceção de pedido não encontrada",
      };
    }
    return { allowed: true, tenantId };
  }

  if (
    !(ORDER_EXCEPTION_GLOBAL_ROLES as readonly string[]).includes(actor.role)
  ) {
    return {
      allowed: false,
      status: 403,
      message: "Este perfil precisa estar vinculado a uma empresa",
    };
  }

  if (requestedCompanyId == null) {
    return { allowed: true, tenantId: null };
  }

  if (
    !Number.isInteger(Number(requestedCompanyId)) ||
    Number(requestedCompanyId) <= 0
  ) {
    return {
      allowed: false,
      status: 400,
      message: "companyId inválido",
    };
  }

  return { allowed: true, tenantId: Number(requestedCompanyId) };
}

export function extractRequestedCompanyId(body: unknown): number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const input = body as Record<string, unknown>;
  const raw =
    input.companyId ??
    input.company_id ??
    input.empresaId ??
    input.empresa_id;
  if (raw === undefined || raw === null || raw === "") return null;

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

export function sanitizeOrderExceptionBody(
  body: unknown,
): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }

  const input = body as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of ["reason", "expiryDate", "active"]) {
    if (key in input) safe[key] = input[key];
  }
  return safe;
}