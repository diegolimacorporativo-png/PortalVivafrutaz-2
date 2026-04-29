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
};
