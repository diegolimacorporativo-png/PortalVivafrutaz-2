import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { api } from "@shared/routes";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { currentTenantId } from "../core/tenant/context";

/**
 * FASE MT-3D — companyId hardening.
 *
 * Anteriormente estes endpoints liam `companyId` direto do `req.query`,
 * permitindo que um ADMIN da empresa A informasse `?companyId=B` e obtivesse
 * dados de outro tenant.
 *
 * Agora a lógica é:
 *   1. Se há tenant pinado no AsyncLocalStorage (usuário com empresa) → usa
 *      esse ID e IGNORA qualquer parâmetro da requisição.
 *   2. Se não há tenant (admin cross-tenant, e.g. MASTER sem X-Empresa-Id) →
 *      aceita `req.query.companyId` como filtro opcional, igual ao
 *      comportamento anterior — pois esse usuário já tem acesso global.
 */
function resolveCompanyId(req: any): number | undefined {
  const tid = currentTenantId();
  if (tid != null) return tid;
  const qp = req.query.companyId;
  return qp ? Number(qp) : undefined;
}

export function register(app: Express) {
  // Industrialized products report
  app.get('/api/reports/industrialized', requireAuthCore, requireRole(["ADMIN", "DIRECTOR", "MASTER"]), async (req, res) => {
    try {
      const { dateFrom, dateTo, productId } = req.query;
      const companyId = resolveCompanyId(req);
      const data = await storage.getIndustrializedReport({
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
        companyId,
        productId: productId ? Number(productId) : undefined,
      });
      res.json(data);
    } catch (err: any) {
      console.error("[reports] industrialized error", err);
      res.status(500).json({ message: "Erro ao buscar relatório" });
    }
  });

  // Reports — real data from DB
  app.get(api.reports.purchasing.path, requireAuthCore, requireRole(["ADMIN", "DIRECTOR", "MASTER"]), async (req, res) => {
    try {
      const { dateFrom, dateTo, productId } = req.query;
      const companyId = resolveCompanyId(req);
      const data = await storage.getPurchasingReport({
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
        companyId,
        productId: productId ? Number(productId) : undefined,
      });
      res.json(data);
    } catch (err: any) {
      console.error("[reports] purchasing error", err);
      res.status(500).json({ message: "Erro ao buscar relatório" });
    }
  });

  app.get(api.reports.financial.path, requireAuthCore, requireRole(["ADMIN", "DIRECTOR", "MASTER"]), async (req, res) => {
    res.json({
      weeklyRevenue: 4500.00,
      monthlyRevenue: 18200.00,
      topCompanies: [
        { companyName: "TechCorp", totalSpent: 1200 },
        { companyName: "HealthPlus", totalSpent: 850 }
      ],
      topSellingFruits: [
        { productName: "Banana Box", totalSold: 200 },
        { productName: "Apple Box", totalSold: 150 }
      ]
    });
  });
}
