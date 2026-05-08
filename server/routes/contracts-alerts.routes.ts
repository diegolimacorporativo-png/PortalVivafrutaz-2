import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { ok, fail } from "../core/http/apiResponse";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
import { crossTenant } from "../core/tenant/scope";

export function register(app: Express) {
  // MT-3C — requireRole added: this endpoint calls storage.getCompanies() (cross-tenant)
  // and must not be reachable by FINANCEIRO, LOGISTICS, DRIVER, or other per-tenant roles.
  // crossTenant() marks the intentional global read; restricted to MASTER/ADMIN/DIRECTOR.
  app.get('/api/contracts/alerts', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DIRECTOR']), async (req, res) => {
    try {
      void crossTenant(); // intentional: scans all empresas for contract deadlines
      const companies = await storage.getCompanies();
      const now = new Date();
      const alerts: any[] = [];

      for (const company of companies) {
        if (!company.active) continue;
        const c = company as any;

        if (c.contractVigencia === 'prazo_indefinido' && c.contractStartDate) {
          const start = new Date(c.contractStartDate);
          const monthsDiff = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
          if (monthsDiff >= 12) {
            const adjs = await storage.getContractAdjustments(company.id);
            const lastAdj = adjs[0];
            const lastAdjDate = lastAdj ? new Date(lastAdj.createdAt) : start;
            const monthsSinceAdj = (now.getFullYear() - lastAdjDate.getFullYear()) * 12 + (now.getMonth() - lastAdjDate.getMonth());
            if (monthsSinceAdj >= 12) {
              alerts.push({ type: '12_months', companyId: company.id, companyName: company.companyName, contractStartDate: c.contractStartDate, monthsActive: monthsDiff, monthsSinceLastAdjustment: monthsSinceAdj });
            }
          }
        }

        if (c.contractVigencia === 'prazo_determinado' && c.contractEndDate) {
          const end = new Date(c.contractEndDate);
          const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (daysLeft <= 90 && daysLeft >= 0) {
            alerts.push({ type: 'expiring', companyId: company.id, companyName: company.companyName, contractEndDate: c.contractEndDate, daysLeft });
          }
        }
      }

      return ok(res, alerts);
    } catch (e: any) { return fail(res, e.message, 'INTERNAL_ERROR', 500); }
  });
}
