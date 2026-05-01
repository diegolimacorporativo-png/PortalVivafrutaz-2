import type { Express } from "express";
import { storage } from "../services/storage.ts";

export function register(app: Express) {
  // Company validation endpoint — checks all companies for missing required fields
  app.get('/api/admin/companies/validate', async (req, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
      const user = await storage.getUser(req.session.userId);
      if (!user || !['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(user.role)) return res.status(403).json({ message: 'Sem permissão' });

      const companies = await storage.getCompanies();
      const issues: { id: number; companyName: string; problems: string[] }[] = [];

      for (const c of companies) {
        const problems: string[] = [];
        if (!c.companyName?.trim()) problems.push('Nome da empresa ausente');
        if (!c.contactName?.trim()) problems.push('Nome do responsável ausente');
        if (!c.email?.trim()) problems.push('Email ausente');
        if (!c.password?.trim()) problems.push('Senha ausente');
        if (!c.allowedOrderDays || !Array.isArray(c.allowedOrderDays) || (c.allowedOrderDays as any[]).length === 0) {
          problems.push('Nenhum dia de entrega configurado');
        }
        if (!c.active) problems.push('Conta inativa');
        if (problems.length > 0) issues.push({ id: c.id, companyName: c.companyName, problems });
      }

      res.json({
        total: companies.length,
        valid: companies.length - issues.length,
        withIssues: issues.length,
        issues,
        summary: issues.length === 0
          ? `Todos os ${companies.length} clientes estão com dados válidos.`
          : `${issues.length} cliente(s) com dados incompletos encontrados.`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || 'Erro na validação' });
    }
  });
}
