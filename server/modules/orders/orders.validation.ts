import { z } from "zod";

/**
 * Validation layer for the orders module.
 *
 * Architecture decision: only the request shapes that the migrated endpoints
 * actually need live here. As more endpoints (create/update/delete/etc.) are
 * migrated out of the legacy `routes.ts`, their schemas should be added here
 * by extending the auto-generated `insertOrderSchema` from `@shared/schema`
 * (single source of truth).
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
