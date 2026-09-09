import { z } from "zod";

/**
 * Validation layer for the finance module.
 *
 * Architecture decision: we extend the auto-generated Drizzle insert schemas
 * (single source of truth from `@shared/schema`) and tighten them where the
 * HTTP layer needs stricter rules than the database. The controller never
 * touches Zod directly — it receives parsed, typed data via validateRequest.
 */

// ── Accounts Receivable ──────────────────────────────────────────────────
const money = z.union([z.string(), z.number()]).transform(String);
const date = z.string().min(1);

// HTTP DTOs intentionally exclude id, tenantId, status, pagoEm and pixPayload.
// Those fields are server-controlled state, not editable business input.
export const createAccountReceivableSchema = z.object({
  companyId: z.number().int().positive().nullable().optional(),
  orderId: z.number().int().positive().nullable().optional(),
  descricao: z.string().min(1, "Descrição é obrigatória"),
  valor: money,
  dataEmissao: date,
  dataVencimento: date,
  formaPagamento: z.enum(["pix", "boleto", "transferencia", "dinheiro"]).optional(),
  observacoes: z.string().max(2000).nullable().optional(),
});

export const updateAccountReceivableSchema =
  createAccountReceivableSchema
    .omit({ companyId: true, orderId: true })
    .partial();

export const accountsReceivableQuerySchema = z.object({
  status: z.string().optional(),
  companyId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? undefined : Number(v)))
    .refine((v) => v === undefined || (Number.isInteger(v) && v > 0), "companyId inválido"),
});

// ── Accounts Payable ─────────────────────────────────────────────────────
export const createAccountPayableSchema = z.object({
  fornecedor: z.string().min(1, "Fornecedor é obrigatório"),
  descricao: z.string().min(1, "Descrição é obrigatória"),
  valor: money,
  dataVencimento: date,
  categoria: z.enum(["fornecedor", "logistica", "operacional", "outros"]).optional(),
  observacoes: z.string().max(2000).nullable().optional(),
});

export const updateAccountPayableSchema = createAccountPayableSchema
  .omit({ fornecedor: true })
  .partial();

export const accountsPayableQuerySchema = z.object({
  status: z.string().optional(),
});

// ── Cashflow ─────────────────────────────────────────────────────────────
export const cashflowQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const createCashflowEntrySchema = z.object({
  tipo: z.enum(["entrada", "saida"]),
  valor: money,
  descricao: z.string().min(1),
  data: date,
});

// ── Path params ──────────────────────────────────────────────────────────
export const idParamSchema = z.object({
  id: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n > 0, { message: "ID inválido" }),
});
