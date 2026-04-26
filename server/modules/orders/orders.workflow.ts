import { BadRequestError, ForbiddenError } from "../../shared/errors/AppError";

// ─── Legacy status alignment ──────────────────────────────────────────────────
/**
 * Maps each `workflowStatus` value to the equivalent legacy `status` value
 * written in the `orders.status` column.
 *
 * Purpose: prevent the two columns from drifting apart. Every time
 * `workflowStatus` changes, `status` is updated to the corresponding value
 * inside the same DB transaction — so any frontend, report, or legacy endpoint
 * that still reads `orders.status` sees a consistent picture without
 * any code change on their side.
 *
 * Mapping rationale:
 *  CREATED / PENDING_APPROVAL → "ACTIVE"    (order exists, not yet actionable)
 *  APPROVED / INVOICED / SHIPPED → "CONFIRMED" (admin-approved, progressing)
 *  DELIVERED  → "DELIVERED"
 *  REJECTED   → "CANCELLED"  (terminal rejection ≡ cancelled in legacy)
 *  CANCELLED  → "CANCELLED"
 */
export const LEGACY_STATUS_MAP: Record<string, string> = {
  CREATED:          "ACTIVE",
  PENDING_APPROVAL: "ACTIVE",
  APPROVED:         "CONFIRMED",
  PROCESSING:       "CONFIRMED",
  READY:            "CONFIRMED",
  INVOICED:         "CONFIRMED",
  SHIPPED:          "CONFIRMED",
  DELIVERED:        "DELIVERED",
  REJECTED:         "CANCELLED",
  CANCELLED:        "CANCELLED",
};

/**
 * Returns the legacy `status` that should be written alongside `workflowStatus`.
 * Falls back to the existing legacy status if the mapping is unknown.
 */
export function legacyStatusFor(workflowStatus: string, current: string): string {
  return LEGACY_STATUS_MAP[workflowStatus] ?? current;
}

/**
 * OrderStatus — the controlled state machine for the order workflow.
 *
 * These values live in `orders.workflow_status` (a separate column from the
 * legacy `orders.status`). The legacy column is untouched so every existing
 * endpoint, frontend query, and report continues to work exactly as before.
 *
 * Terminal states: DELIVERED, REJECTED, CANCELLED — no forward transitions.
 */
export const OrderStatus = {
  CREATED:          "CREATED",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED:         "APPROVED",
  PROCESSING:       "PROCESSING",
  READY:            "READY",
  REJECTED:         "REJECTED",
  INVOICED:         "INVOICED",
  SHIPPED:          "SHIPPED",
  DELIVERED:        "DELIVERED",
  CANCELLED:        "CANCELLED",
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/**
 * Allowed transitions map.
 *
 * Key   = current workflowStatus.
 * Value = set of statuses the order can legally move to from here.
 *
 * Rationale for each arc:
 *  CREATED          → PENDING_APPROVAL (normal flow) | CANCELLED (abort before review)
 *  PENDING_APPROVAL → APPROVED (admin approves) | REJECTED (admin rejects) | CANCELLED
 *  APPROVED         → INVOICED (fiscal creates pre-nota) | CANCELLED (rare abort)
 *  REJECTED         → terminal (no recovery — create a new order if needed)
 *  INVOICED         → SHIPPED (logistics dispatches) | CANCELLED (invoice voided)
 *  SHIPPED          → DELIVERED (delivery confirmed)
 *  DELIVERED        → terminal
 *  CANCELLED        → terminal
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.CREATED]:          [OrderStatus.PENDING_APPROVAL, OrderStatus.CANCELLED],
  [OrderStatus.PENDING_APPROVAL]: [OrderStatus.APPROVED, OrderStatus.REJECTED, OrderStatus.CANCELLED],
  // APPROVED can either go straight to INVOICED (legacy fast path) or step
  // through the operational pipeline PROCESSING → READY before invoicing.
  [OrderStatus.APPROVED]:         [OrderStatus.PROCESSING, OrderStatus.INVOICED, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]:       [OrderStatus.READY, OrderStatus.CANCELLED],
  [OrderStatus.READY]:            [OrderStatus.INVOICED, OrderStatus.CANCELLED],
  [OrderStatus.REJECTED]:         [],
  [OrderStatus.INVOICED]:         [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]:          [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]:        [],
  [OrderStatus.CANCELLED]:        [],
};

/**
 * Roles that may trigger each transition.
 *
 * Undefined = any authenticated user (service enforces authentication separately).
 * A non-empty array = RBAC gate applied on top of authentication.
 */
const TRANSITION_ROLES: Partial<Record<OrderStatus, readonly string[]>> = {
  [OrderStatus.APPROVED]:  ["MASTER", "ADMIN", "DIRECTOR", "FINANCEIRO", "OPERATIONS_MANAGER"],
  [OrderStatus.PROCESSING]:["MASTER", "ADMIN", "DIRECTOR", "LOGISTICS", "OPERATIONS_MANAGER"],
  [OrderStatus.READY]:     ["MASTER", "ADMIN", "DIRECTOR", "LOGISTICS", "OPERATIONS_MANAGER"],
  [OrderStatus.REJECTED]:  ["MASTER", "ADMIN", "DIRECTOR", "OPERATIONS_MANAGER"],
  [OrderStatus.INVOICED]:  ["MASTER", "ADMIN", "DIRECTOR", "FINANCEIRO"],
  [OrderStatus.SHIPPED]:   ["MASTER", "ADMIN", "DIRECTOR", "LOGISTICS", "OPERATIONS_MANAGER"],
  [OrderStatus.DELIVERED]: ["MASTER", "ADMIN", "DIRECTOR", "LOGISTICS", "OPERATIONS_MANAGER"],
  [OrderStatus.CANCELLED]: ["MASTER", "ADMIN", "DIRECTOR", "FINANCEIRO", "OPERATIONS_MANAGER"],
};

/**
 * Assert the requested transition is allowed from the current state.
 * Throws `BadRequestError` with a human-readable reason if invalid.
 */
export function assertTransitionAllowed(from: string, to: OrderStatus): void {
  const normalizedFrom = (from || OrderStatus.CREATED) as OrderStatus;
  const allowed = ALLOWED_TRANSITIONS[normalizedFrom] ?? [];
  if (!allowed.includes(to)) {
    throw new BadRequestError(
      `Transição inválida: ${normalizedFrom} → ${to}. ` +
      `Transições permitidas: [${allowed.join(", ") || "nenhuma"}].`,
    );
  }
}

/**
 * Assert the caller holds a role permitted to drive the requested transition.
 * Throws `ForbiddenError` if the role is not in the allowlist.
 * No-ops when the target state has no role restriction.
 */
export function assertTransitionRole(to: OrderStatus, userRole: string): void {
  const allowed = TRANSITION_ROLES[to];
  if (allowed && !allowed.includes(userRole)) {
    throw new ForbiddenError(
      `Seu perfil (${userRole}) não pode mover pedidos para o estado ${to}.`,
    );
  }
}

/**
 * Business rules checked BEFORE each sensitive transition is persisted.
 * Each rule is async so it can query the DB. Throw `BadRequestError` to veto.
 *
 * Rules:
 *  → APPROVED  : customer must be active (not locked), no overdue invoices
 *  → INVOICED  : order must already be APPROVED (enforced by transition map)
 *  → SHIPPED   : a pre-nota number or fiscal note must already exist
 */
export type PreTransitionContext = {
  orderId: number;
  to: OrderStatus;
  company: any;
  orderRow: any;
  arByCompany: any[];
};

export function validateBusinessRules(ctx: PreTransitionContext): void {
  const { to, company, orderRow, arByCompany } = ctx;

  if (to === OrderStatus.APPROVED) {
    if (!company) {
      throw new BadRequestError("Empresa do pedido não encontrada.");
    }
    if (!company.active || company.isLocked) {
      throw new BadRequestError(
        `Empresa "${company.companyName}" está bloqueada e não pode ter pedidos aprovados.`,
      );
    }
    const hasOverdue = arByCompany.some((ar: any) => ar.status === "vencido");
    if (hasOverdue) {
      throw new BadRequestError(
        `Empresa "${company.companyName}" possui cobranças vencidas em aberto. Regularize antes de aprovar.`,
      );
    }
  }

  if (to === OrderStatus.SHIPPED) {
    const hasInvoice =
      orderRow.preNotaNumber ||
      orderRow.fiscalStatus === "nota_emitida" ||
      orderRow.fiscalStatus === "nota_exportada";
    if (!hasInvoice) {
      throw new BadRequestError(
        "O pedido precisa ter uma nota fiscal gerada antes de ser enviado para expedição.",
      );
    }
  }
}
