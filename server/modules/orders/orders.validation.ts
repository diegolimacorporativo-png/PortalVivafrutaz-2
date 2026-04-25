import { z } from "zod";

/**
 * Validation layer for the orders module.
 *
 * Architecture decision: only the request shapes that the migrated endpoints
 * actually need live here. As more endpoints are migrated out of the legacy
 * `routes.ts`, their schemas should be added here by extending the
 * auto-generated `insertOrderSchema` from `@shared/schema` (single source of
 * truth) rather than duplicating column lists.
 *
 * IMPORTANT: validation is INTENTIONALLY permissive on shape (most legacy
 * callers pass loosely-typed payloads). We coerce numerics where the legacy
 * code did `Number(req.params.id)` and we accept `unknown` for free-form
 * fields the storage layer is already tolerant of. Tightening these schemas
 * is its own follow-up — the structural migration must NOT change behavior.
 */

// ── Path params ──────────────────────────────────────────────────────────
export const idParamSchema = z.object({
  id: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n > 0, { message: "ID inválido" }),
});

// ── Query strings ────────────────────────────────────────────────────────
/**
 * `GET /api/orders?empresaId=<number>` — kept identical to the legacy query
 * contract so existing frontend callers keep working unchanged.
 */
export const listOrdersQuerySchema = z.object({
  empresaId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) =>
      v === undefined || v === "" || v === null ? undefined : Number(v),
    )
    .refine((v) => v === undefined || (Number.isInteger(v) && v > 0), {
      message: "empresaId inválido",
    }),
});

/**
 * `GET /api/orders/export?dateFrom&dateTo&companyId&orderType` — query-only
 * report endpoint; all fields are optional and free-form (sentinel "all" is
 * accepted to mirror the legacy contract).
 */
export const exportQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  companyId: z.union([z.string(), z.number()]).optional(),
  orderType: z.string().optional(),
});

// ── Bodies ───────────────────────────────────────────────────────────────
/**
 * `POST /api/orders` — body is `{ order, items }`. We intentionally don't
 * type the inner shapes here (the storage layer + downstream side-effects
 * already deal with the legacy permissive payload). Tightening this requires
 * a coordinated frontend change and is out of scope for the structural pass.
 */
export const createOrderBodySchema = z.object({
  order: z.record(z.string(), z.any()),
  items: z.array(z.record(z.string(), z.any())),
});

/** `POST /api/orders/create-with-delivery` — admin/internal create+ship. */
export const createWithDeliveryBodySchema = z
  .object({
    companyId: z.union([z.string(), z.number()]).transform((v) => Number(v)),
    deliveryDate: z.union([z.string(), z.date()]).optional(),
    items: z.array(z.record(z.string(), z.any())).optional(),
  })
  .passthrough(); // legacy spreads `...rest` into createOrder

/** `PATCH /api/orders/:id` — partial update for status/notes/nimbi. */
export const updateOrderBodySchema = z
  .object({
    status: z.string().optional(),
    adminNote: z.string().optional(),
    nimbiExpiration: z.string().nullable().optional(),
  })
  .passthrough();

/** `DELETE /api/orders/:id` body — `{ motivo, confirmar }`. */
export const deleteOrderBodySchema = z.object({
  motivo: z.string().optional(),
  confirmar: z.boolean().optional(),
});

/** `DELETE /api/orders/bulk` body. */
export const bulkDeleteBodySchema = z.object({
  orderIds: z.array(z.union([z.string(), z.number()])).min(1, {
    message: "Nenhum pedido selecionado",
  }),
  motivo: z.string().optional(),
  confirmar: z.boolean().optional(),
});

/** `POST /api/orders/:id/request-reopen`. */
export const requestReopenBodySchema = z.object({
  reason: z
    .string()
    .min(3, { message: "Informe o motivo da alteração." }),
});

/** `POST /api/orders/:id/finalize-edit`. */
export const finalizeEditBodySchema = z.object({
  items: z.array(z.record(z.string(), z.any())).optional(),
});

/** `PUT /api/orders/:id/items`. */
export const updateOrderItemsBodySchema = z.object({
  items: z.array(z.record(z.string(), z.any())),
});

/** `POST /api/orders/:id/substitute-item`. */
export const substituteItemBodySchema = z.object({
  action: z.enum(["remove", "replace", "discount", "note"]),
  itemId: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  newProductId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v))),
  discountPct: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v))),
  nfNote: z.string().optional(),
});

/** `PATCH /api/orders/:id/fiscal`. */
export const updateFiscalBodySchema = z.object({
  fiscalStatus: z.string().optional(),
  preNotaNumber: z.string().nullable().optional(),
});

/** `POST /api/orders/:id/danfe-log`. */
export const createDanfeLogBodySchema = z
  .object({
    orderCode: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * `POST /api/orders/:id/transition`
 *
 * `to`     — the target workflowStatus value (enum validated here).
 * `reason` — optional human-readable note recorded in the audit log.
 */
export const transitionBodySchema = z.object({
  to: z.enum([
    "CREATED",
    "PENDING_APPROVAL",
    "APPROVED",
    "REJECTED",
    "INVOICED",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ]),
  reason: z.string().max(500).optional(),
});
