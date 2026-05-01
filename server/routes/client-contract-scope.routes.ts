import type { Express } from "express";
import { storage } from "../services/storage.ts";

export function register(app: Express) {
  // ─── Client Contract Scope Routes ────────────────────────────────────────
  app.get('/api/client/contract-scope', async (req: any, res) => {
    const companyId = req.session?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const company = await storage.getCompany(companyId);
      if (!company || company.clientType !== 'contratual') return res.status(403).json({ message: 'Acesso restrito a clientes contratuais' });
      const rawScopes = await storage.getContractScopes(companyId);
      const allProducts = await storage.getProducts();
      const productMap = new Map(allProducts.map((p: any) => [p.id, p]));
      const scopes = rawScopes.map((s: any) => {
        const product = productMap.get(s.productId);
        return {
          ...s,
          productName: product?.name || null,
          categoryName: s.scopeCategory || product?.category || null,
        };
      });
      res.json({ scopes, company });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/client/scope-change-request', async (req: any, res) => {
    const companyId = req.session?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      const company = await storage.getCompany(companyId);
      if (!company || company.clientType !== 'contratual') return res.status(403).json({ message: 'Acesso restrito a clientes contratuais' });
      const { message } = req.body;
      if (!message || typeof message !== 'string' || message.trim().length < 5) {
        return res.status(400).json({ message: 'Mensagem inválida' });
      }
      const task = await storage.createTask({
        title: `Solicitação de alteração de escopo — ${company.companyName}`,
        description: `Cliente: ${company.companyName} (ID #${company.id})\nContato: ${company.contactName || '—'}\n\nMensagem do cliente:\n${message.trim()}`,
        priority: 'medium',
        createdByName: company.companyName,
      });
      res.json({ success: true, taskId: task.id });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}
