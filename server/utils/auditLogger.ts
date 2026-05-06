/**
 * auditLogger — helper centralizado de auditoria de ações críticas.
 *
 * HARDENING: persiste eventos no banco via storage.createLog() (fire-and-forget)
 * além do console.warn original. Nunca lança exceção — falhas de IO são
 * logadas como console.error mas não interrompem o fluxo da requisição.
 *
 * SECURITY_FLAGS.AUDIT_LOG controla a persistência em DB.
 * console.warn é mantido independentemente do flag.
 */

import { SECURITY_FLAGS } from "../core/security/securityFlags";

const FULL_ACCESS_ROLES = ['MASTER', 'ADMIN', 'DIRECTOR'];

export interface AuditMeta {
  userId: number | undefined;
  role: string | undefined;
  empresaId?: number | null;
  entity?: string;
  entityId?: number | string;
  details?: any;
  ip?: string;
}

export function auditLog(action: string, meta: AuditMeta): void {
  const entry = { action, ...meta, timestamp: Date.now() };
  console.warn("[AUDIT]", entry);

  if (FULL_ACCESS_ROLES.includes(meta.role ?? '')) {
    console.warn("[AUDIT]", { action: "FULL_ACCESS_ACTION", originalAction: action, ...meta, timestamp: Date.now() });
  }

  if (SECURITY_FLAGS.AUDIT_LOG) {
    const description = JSON.stringify({
      entity: meta.entity,
      entityId: meta.entityId,
      empresaId: meta.empresaId,
      details: meta.details,
    });

    import("../services/storage")
      .then(({ storage }) =>
        storage.createLog({
          action,
          description,
          userId: meta.userId,
          companyId: meta.empresaId ?? undefined,
          userRole: meta.role,
          ip: meta.ip,
          level: "INFO",
        }),
      )
      .catch((err: Error) => {
        console.error("[AUDIT_DB_FAIL]", { action, error: err?.message });
      });
  }
}

/**
 * auditSecurity — variante para eventos de segurança (auth, sessão, rate limit).
 * Usa level=WARN ou ALERT para diferenciar no painel de logs.
 */
export function auditSecurity(
  action: string,
  meta: AuditMeta & { level?: "WARN" | "ALERT" | "INFO" },
): void {
  const level = meta.level ?? "WARN";
  const entry = { action, ...meta, timestamp: new Date().toISOString() };

  console.warn("[SECURITY]", {
    type: action,
    userId: meta.userId,
    ip: meta.ip,
    timestamp: entry.timestamp,
  });

  if (SECURITY_FLAGS.AUDIT_LOG) {
    import("../services/storage")
      .then(({ storage }) =>
        storage.createLog({
          action: `SECURITY:${action}`,
          description: JSON.stringify({ details: meta.details }),
          userId: meta.userId,
          companyId: meta.empresaId ?? undefined,
          userRole: meta.role,
          ip: meta.ip,
          level,
        }),
      )
      .catch((err: Error) => {
        console.error("[AUDIT_SECURITY_DB_FAIL]", { action, error: err?.message });
      });
  }
}
