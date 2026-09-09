export const EMPRESA_CONFIG_ROLES = [
  "MASTER",
  "ADMIN",
  "DEVELOPER",
  "DIRECTOR",
] as const;

/**
 * Only roles with an established cross-tenant convention may select another
 * company when their user record has no empresaId. A role alone does not make
 * a tenant-bound user global.
 */
export const EMPRESA_CONFIG_GLOBAL_ROLES = ["MASTER", "DIRECTOR"] as const;

type SupportedRole = (typeof EMPRESA_CONFIG_ROLES)[number];

export type EmpresaConfigActor = {
  role?: string | null;
  empresaId?: number | null;
};

export type EmpresaConfigAccess =
  | { allowed: true; tenantId: number | null }
  | { allowed: false; status: 403 | 404; message: string };

export function resolveEmpresaConfigAccess(
  actor: EmpresaConfigActor,
  requestedEmpresaId: number,
): EmpresaConfigAccess {
  if (
    !Number.isInteger(requestedEmpresaId) ||
    requestedEmpresaId <= 0
  ) {
    return {
      allowed: false,
      status: 404,
      message: "Configuração da empresa não encontrada",
    };
  }

  if (
    !actor.role ||
    !(EMPRESA_CONFIG_ROLES as readonly string[]).includes(actor.role)
  ) {
    return {
      allowed: false,
      status: 403,
      message: "Acesso negado",
    };
  }

  if (actor.empresaId != null) {
    if (Number(actor.empresaId) !== requestedEmpresaId) {
      return {
        allowed: false,
        status: 404,
        message: "Configuração da empresa não encontrada",
      };
    }

    return { allowed: true, tenantId: requestedEmpresaId };
  }

  if (
    !(EMPRESA_CONFIG_GLOBAL_ROLES as readonly string[]).includes(actor.role)
  ) {
    return {
      allowed: false,
      status: 403,
      message: "Este perfil precisa estar vinculado a uma empresa",
    };
  }

  return { allowed: true, tenantId: null };
}

/**
 * The URL is the only source of the target company. Tenant-identifying body
 * fields are ignored so a patch cannot move a configuration to another tenant.
 */
export function sanitizeEmpresaConfigBody(
  body: unknown,
): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }

  const safe = { ...(body as Record<string, unknown>) };
  for (const key of [
    "tenantId",
    "tenant_id",
    "empresaId",
    "empresa_id",
    "companyId",
    "company_id",
  ]) {
    delete safe[key];
  }
  return safe;
}