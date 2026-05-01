import type { Express } from "express";
import { db } from "../database/db.ts";
import { sql } from "drizzle-orm";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";

export function register(app: Express) {
  app.get('/api/search', requireAuthCore, async (req: any, res) => {
    try {
      const q = ((req.query.q as string) || '').trim();
      if (!q || q.length < 2) return res.json({ results: [], total: 0 });
      const term = `%${q.toLowerCase()}%`;
      const results: any[] = [];

      const comps = await db.execute(sql`SELECT id, company_name, contact_name FROM companies WHERE LOWER(company_name) LIKE ${term} OR LOWER(contact_name) LIKE ${term} LIMIT 5`);
      for (const c of comps.rows) {
        results.push({ id: c.id, label: c.company_name, sublabel: c.contact_name as string, href: '/admin/companies', category: 'Clientes' });
      }

      const prods = await db.execute(sql`SELECT id, name, product_code FROM products WHERE LOWER(name) LIKE ${term} OR LOWER(COALESCE(product_code,'')) LIKE ${term} LIMIT 5`);
      for (const p of prods.rows) {
        results.push({ id: p.id, label: p.name as string, sublabel: p.product_code ? `#${p.product_code}` : undefined, href: '/admin/products', category: 'Produtos' });
      }

      const ords = await db.execute(sql`SELECT o.id, c.company_name, o.status FROM orders o LEFT JOIN companies c ON o.company_id = c.id WHERE LOWER(COALESCE(c.company_name,'')) LIKE ${term} OR CAST(o.id AS TEXT) LIKE ${term} LIMIT 5`);
      for (const o of ords.rows) {
        results.push({ id: o.id, label: `Pedido #${o.id}`, sublabel: o.company_name as string, href: '/admin/orders', category: 'Pedidos' });
      }

      const conts = await db.execute(sql`SELECT id, company_name, contract_start_date FROM companies WHERE client_type = 'contratual' AND (LOWER(company_name) LIKE ${term}) LIMIT 5`);
      for (const c of conts.rows) {
        results.push({ id: c.id, label: `Contrato: ${c.company_name}`, sublabel: c.contract_start_date ? `Início: ${c.contract_start_date}` : undefined, href: '/admin/contracts', category: 'Contratos' });
      }

      const nfs = await db.execute(sql`SELECT id, invoice_number, supplier FROM fiscal_invoices WHERE LOWER(COALESCE(invoice_number,'')) LIKE ${term} OR LOWER(COALESCE(supplier,'')) LIKE ${term} LIMIT 5`);
      for (const n of nfs.rows) {
        results.push({ id: n.id, label: `NF ${n.invoice_number || n.id}`, sublabel: n.supplier as string, href: '/admin/fiscal', category: 'Notas Fiscais' });
      }

      const cats = await db.execute(sql`SELECT id, name FROM categories WHERE LOWER(name) LIKE ${term} LIMIT 5`);
      for (const c of cats.rows) {
        results.push({ id: c.id, label: c.name as string, href: '/admin/categories', category: 'Categorias' });
      }

      const usrs = await db.execute(sql`SELECT id, name, email, role FROM users WHERE LOWER(name) LIKE ${term} OR LOWER(email) LIKE ${term} LIMIT 5`);
      for (const u of usrs.rows) {
        results.push({ id: u.id, label: u.name as string, sublabel: u.email as string, href: '/admin/users', category: 'Usuários' });
      }

      res.json({ results, total: results.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
