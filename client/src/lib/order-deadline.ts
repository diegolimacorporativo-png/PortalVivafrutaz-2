export {
  calculateOrderModificationDeadline,
  ORDER_MODIFICATION_EXPIRED_MESSAGE,
  REOPENED_ORDER_EXPIRED_MESSAGE,
} from "@shared/utils/orderDeadline";
export type { DeadlineOptions, DeadlineResult } from "@shared/utils/orderDeadline";

export type DeadlineAction =
  | "edit"
  | "request-change"
  | "request-cancellation"
  | "reopen";

export interface DeadlineAuditPayload {
  orderId: number;
  companyId?: number | null;
  userId?: number | null;
  now: string;
  deadline: string;
  canModify: boolean;
  reason: string;
  action: DeadlineAction;
}

// ─── Auditoria ─────────────────────────────────────────────────────────────────

/**
 * Envia um registro de auditoria ao servidor (fire-and-forget).
 *
 * - Nunca lança exceção; erros de rede são silenciados.
 * - O servidor recalcula os dados usando a sessão e persiste a auditoria.
 *
 * @param payload Dados do registro: pedido, empresa, usuário, datas, resultado
 */
export function logDeadlineAudit(payload: DeadlineAuditPayload): void {
  fetch(`/api/orders/${payload.orderId}/deadline-audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    // The server must recalculate the deadline and identify the actor from
    // the authenticated session; never trust audit values supplied by UI.
    body: JSON.stringify({ action: payload.action }),
  }).catch(() => {
    // Silently ignore — erros de rede nunca devem bloquear a UX
  });
}

export function isOperationalDeadlineError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("OPERATIONAL_DEADLINE_EXPIRED") ||
    message.includes("Prazo para solicitar alterações ou cancelamentos deste pedido foi encerrado") ||
    message.includes("prazo operacional para alterações já expirou")
  );
}
