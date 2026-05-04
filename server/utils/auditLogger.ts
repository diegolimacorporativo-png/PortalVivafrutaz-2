/**
 * auditLogger — helper centralizado de auditoria de ações críticas.
 *
 * DESIGN: apenas console.warn por ora — sem schema, sem tabela, sem bloqueio.
 * Evolução futura: trocar o body do console.warn por inserção em DB/fila.
 *
 * Etapa 5: roles FULL_ACCESS disparam log adicional "FULL_ACCESS_ACTION"
 * para rastreabilidade total de super-usuários.
 */

const FULL_ACCESS_ROLES = ['MASTER', 'ADMIN', 'DIRECTOR'];

export interface AuditMeta {
  userId: number | undefined;
  role: string | undefined;
  empresaId?: number | null;
  entity?: string;
  entityId?: number | string;
  details?: any;
}

export function auditLog(action: string, meta: AuditMeta): void {
  const entry = { action, ...meta, timestamp: Date.now() };
  console.warn("[AUDIT]", entry);

  if (FULL_ACCESS_ROLES.includes(meta.role ?? '')) {
    console.warn("[AUDIT]", { action: "FULL_ACCESS_ACTION", originalAction: action, ...meta, timestamp: Date.now() });
  }
}
