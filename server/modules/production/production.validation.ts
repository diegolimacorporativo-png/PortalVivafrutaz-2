import { z } from "zod";

export const generateBatchBodySchema = z.object({
  productionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (YYYY-MM-DD)"),
  includeStatuses: z
    .array(z.string())
    .optional()
    .default(["CREATED", "PENDING_APPROVAL", "APPROVED", "INVOICED", "SHIPPED"]),
});

export const batchIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const updateBatchStatusBodySchema = z.object({
  status: z.enum(["PENDENTE", "EM_PRODUCAO", "CONFERIDO", "FINALIZADO"]),
  notes: z.string().optional(),
});

export const updateItemCheckBodySchema = z.object({
  checkedQuantity: z.coerce.number().min(0),
  notes: z.string().optional(),
});

export const listBatchesQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type GenerateBatchBody = z.infer<typeof generateBatchBodySchema>;
export type UpdateBatchStatusBody = z.infer<typeof updateBatchStatusBodySchema>;
export type UpdateItemCheckBody = z.infer<typeof updateItemCheckBodySchema>;
export type ListBatchesQuery = z.infer<typeof listBatchesQuerySchema>;
