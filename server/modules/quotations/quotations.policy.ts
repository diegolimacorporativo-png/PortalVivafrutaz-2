import type { CompanyQuotation } from "@shared/schema";

export const QUOTATION_VIEW_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
  "OPERATIONS_MANAGER",
  "LOGISTICS",
] as const;

export const QUOTATION_DELETE_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
] as const;

export const GLOBAL_QUOTATION_ROLES = ["MASTER", "DIRECTOR"] as const;

export type QuotationActor = {
  role: string;
  empresaId: number | null | undefined;
};

export type QuotationScope =
  | { global: true; empresaId: null }
  | { global: false; empresaId: number };

export type QuotationWritableField = Exclude<
  keyof CompanyQuotation,
  "id" | "empresaId" | "createdAt" | "updatedAt"
>;

const QUOTATION_WRITABLE_FIELDS: readonly QuotationWritableField[] = [
  "companyName",
  "contactName",
  "contactPhone",
  "email",
  "cnpj",
  "address",
  "city",
  "state",
  "estimatedVolume",
  "productInterest",
  "logisticsNote",
  "orderWindowIds",
  "priceGroupId",
  "priceGroupName",
  "status",
  "adminNote",
  "deliveryWindowsJson",
  "deliveryWindowsRespondedBy",
  "deliveryWindowsRespondedAt",
];

const TENANT_OVERRIDE_FIELDS = new Set([
  "companyId",
  "company_id",
  "empresaId",
  "empresa_id",
  "tenantId",
  "tenant_id",
]);

export function canViewQuotations(role: string): boolean {
  return (QUOTATION_VIEW_ROLES as readonly string[]).includes(role);
}

export function canDeleteQuotations(role: string): boolean {
  return (QUOTATION_DELETE_ROLES as readonly string[]).includes(role);
}

/**
 * Null empresaId means that the actor is not pinned to a tenant. Only the
 * existing global roles retain cross-tenant quotation access.
 */
export function resolveQuotationScope(
  actor: QuotationActor | null | undefined,
): QuotationScope | null {
  if (!actor || !canViewQuotations(actor.role)) return null;

  if (actor.empresaId != null) {
    return { global: false, empresaId: actor.empresaId };
  }

  if ((GLOBAL_QUOTATION_ROLES as readonly string[]).includes(actor.role)) {
    return { global: true, empresaId: null };
  }

  return null;
}

export function hasQuotationTenantOverride(
  body: Record<string, unknown>,
): boolean {
  return Object.keys(body).some((key) => TENANT_OVERRIDE_FIELDS.has(key));
}

function pickQuotationFields(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const field of QUOTATION_WRITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      safe[field] = body[field];
    }
  }
  return safe;
}

export function sanitizeQuotationCreateBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  return pickQuotationFields(body);
}

export function sanitizeQuotationUpdateBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  return pickQuotationFields(body);
}
