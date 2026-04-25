import { z } from "zod";

export const createProductSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  description: z.string().optional().nullable(),
  unit: z.string().min(1, "Unidade é obrigatória"),
  pricePerUnit: z.number().positive("Preço deve ser positivo"),
  stock: z.number().int().min(0, "Estoque não pode ser negativo"),
  active: z.boolean().default(true),
});

export const updateProductSchema = createProductSchema.partial();

export const productIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
