import { z } from "zod";
import { insertProductSchema } from "@shared/schema";

export const createProductSchema = insertProductSchema.extend({
  basePrice: z
    .string()
    .nullable()
    .optional()
    .refine(
      (v) => v == null || v === "" || (Number(v) >= 0 && !isNaN(Number(v))),
      { message: "Preço base é obrigatório e deve ser maior ou igual a zero" },
    ),
});

export const updateProductSchema = createProductSchema.partial();

export const productIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
