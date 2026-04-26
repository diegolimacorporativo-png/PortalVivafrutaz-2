import { z } from "zod";

/**
 * Validation layer for the fiscal module (NF Drafts).
 *
 * Drafts são "notas em rascunho" — items são livres (a UI pode adicionar/
 * remover/editar à vontade). Valores numéricos aceitam string OU number e
 * são normalizados para number no controller.
 */

const numberLike = z.union([z.string(), z.number()]).transform((v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
});

export const draftItemSchema = z.object({
  productId: z.number().int().positive().nullable().optional(),
  description: z.string().min(1, "description é obrigatório"),
  quantity: numberLike,
  unit: z.string().min(1).default("KG"),
  unitPrice: numberLike,
  totalPrice: numberLike,
  ncm: z.string().nullable().optional(),
  cfop: z.string().nullable().optional(),
});

export const draftTotalsSchema = z
  .object({
    totalProducts: numberLike.optional(),
    totalDiscount: numberLike.optional(),
    totalFreight: numberLike.optional(),
    totalNF: numberLike.optional(),
  })
  .partial();

export const billingTypeSchema = z.enum(["STANDARD", "CONTRACT"]);
export const draftStatusSchema = z.enum(["draft", "finalized"]);

// POST /api/fiscal/drafts
export const createDraftSchema = z.object({
  orderId: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n > 0, "orderId inválido"),
  billingType: billingTypeSchema.optional(),
});

// PUT /api/fiscal/drafts/:id
export const updateDraftSchema = z
  .object({
    items: z.array(draftItemSchema).optional(),
    totals: draftTotalsSchema.optional(),
    status: draftStatusSchema.optional(),
    billingType: billingTypeSchema.optional(),
  })
  .refine(
    (v) =>
      v.items !== undefined ||
      v.totals !== undefined ||
      v.status !== undefined ||
      v.billingType !== undefined,
    { message: "Payload vazio: informe items, totals, status ou billingType." },
  );

export const idParamSchema = z.object({
  id: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n > 0, "id inválido"),
});

export const orderIdParamSchema = z.object({
  orderId: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n > 0, "orderId inválido"),
});
