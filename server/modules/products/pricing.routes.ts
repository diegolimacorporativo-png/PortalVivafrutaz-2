/**
 * Admin pricing routes — mounted at /api/admin/pricing.
 *
 * Locked behind `requireAuth + requireRole(['ADMIN'])`. Every endpoint
 * delegates straight to the engine in `pricing.service.ts`; no business
 * logic lives here.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../core/http/requireAuth";
import { adjustPrices, rollbackBatch } from "./pricing.service";

const router = Router();

const adjustBodySchema = z.object({
  percentage: z.number().finite(),
  target: z.enum(["base", "subcategory", "all"]),
  productIds: z.array(z.number().int().positive()).optional(),
  categoryIds: z.array(z.number().int().positive()).optional(),
  dryRun: z.boolean(),
});

router.post(
  "/adjust",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = adjustBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Parâmetros inválidos",
          errors: parsed.error.flatten(),
        });
      }
      const userId = (req as any).userId as number | undefined;
      const result = await adjustPrices({ ...parsed.data, appliedBy: userId });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/rollback/:batchId",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const batchId = String(req.params.batchId ?? "");
      if (!batchId) {
        return res.status(400).json({ message: "batchId é obrigatório" });
      }
      const result = await rollbackBatch(batchId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export const pricingAdminRouter = router;
