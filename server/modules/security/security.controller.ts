/**
 * FASE 6.7 — Security Controller (HTTP adapter).
 *
 * Adapter HTTP minimalista. Apenas:
 *   1. Chama `securityService.getResumo()`
 *   2. Devolve `{ success: true, data }`
 *
 * Sem regra de negócio, sem validação Zod, sem try/catch — qualquer falha
 * inesperada é capturada pelo errorHandler central (Express 5 propaga
 * automaticamente promises rejeitadas no handler).
 */
import type { Request, Response } from "express";
import { securityService } from "./security.service";

export const securityController = {
  async resumo(_req: Request, res: Response) {
    const data = await securityService.getResumo();
    return res.json({ success: true, data });
  },

  async tenantMismatchEvents(req: Request, res: Response) {
    try {
      console.log("[SECURITY_AUDIT] Tenant mismatch audit requested");
      const days = Number(req.query.days || 7);
      const data = await securityService.getTenantMismatchEvents(days);
      return res.json({ success: true, data });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: {
          code: "TENANT_MISMATCH_AUDIT_FAILED",
          message: error?.message || "Unknown error",
        },
      });
    }
  },
};
