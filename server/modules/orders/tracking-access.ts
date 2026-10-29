import { ForbiddenError, UnauthorizedError } from "../../shared/errors/AppError";

export type OrderTrackingSession = {
  userId?: number | null;
  userType?: string | null;
  userRole?: string | null;
  role?: string | null;
  companyId?: number | null;
};

export type OrderTrackingAccess =
  | { kind: "company"; companyId: number }
  | { kind: "legacy-client" };

/**
 * Classifies only server-created session fields. Request body, query and
 * headers are deliberately not accepted as inputs to this authorization.
 */
export function classifyOrderTrackingSession(
  session: OrderTrackingSession | null | undefined,
): OrderTrackingAccess {
  if (session?.userType === "company") {
    const companyId = Number(session.companyId);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      throw new UnauthorizedError("Não autenticado");
    }
    return { kind: "company", companyId };
  }

  if (!session?.userId) throw new UnauthorizedError("Não autenticado");
  if ((session.userRole ?? session.role) !== "CLIENT") {
    throw new ForbiddenError("Acompanhamento disponível somente para a empresa do pedido");
  }
  return { kind: "legacy-client" };
}

/**
 * Binds the handler to the tenant installed by tenantContext. A company
 * session can never replace that scope with a client-supplied company ID.
 */
export function resolveOrderTrackingCompanyId(
  access: OrderTrackingAccess,
  tenantId: number | null,
): number {
  if (!Number.isInteger(tenantId) || tenantId == null || tenantId <= 0) {
    throw new UnauthorizedError("Não autenticado");
  }
  if (access.kind === "company" && access.companyId !== tenantId) {
    throw new ForbiddenError("Acompanhamento disponível somente para a empresa do pedido");
  }
  return tenantId;
}
