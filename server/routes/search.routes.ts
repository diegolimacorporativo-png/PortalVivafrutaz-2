import type { Express } from "express";
import { db } from "../database/db.ts";
import { sql } from "drizzle-orm";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import { tenantContext } from "../middleware/tenant";
import { currentTenantId } from "../core/tenant/context";

export function register(app: Express) {
  app.get('/api/search', requireAuthCore, tenantContext, async (req: any, res) => {
    try {
      const tenantId = currentTenantId();
      // Require a pinned tenant — cross-tenant admins (MASTER with no empresaId) get
      // empty results rather than an unscoped full-table scan across all tenants.
      if (tenantId == null) return res.json({ results: [], total: 0 });

      const q = ((req.query.q as string) || '').trim();
      if (!q || q.length < 2) return res.json({ results: [], total: 0 });
      const term = `%${q.toLowerCase()}%`;
      const results: any[] = [];

      // ── Products — has empresa_id column ─────────────────────────────────────
      const prods = await db.execute(sql`
        SELECT id, name, product_code
        FROM products
        WHERE empresa_id = ${tenantId}
          AND (LOWER(name) LIKE ${term} OR LOWER(COALESCE(product_code,'')) LIKE ${term})
        LIMIT 5
      `);
      for (const p of prods.rows) {
        results.push({ id: p.id, label: p.name as string, sublabel: p.product_code ? `#${p.product_code}` : undefined, href: '/admin/products', category: 'Produtos' });
      }

      // ── Categories — has empresa_id column ───────────────────────────────────
      const cats = await db.execute(sql`
        SELECT id, name
        FROM categories
        WHERE empresa_id = ${tenantId}
          AND LOWER(name) LIKE ${term}
        LIMIT 5
      `);
      for (const c of cats.rows) {
        results.push({ id: c.id, label: c.name as string, href: '/admin/categories', category: 'Categorias' });
      }

      // ── Users — has empresa_id column ────────────────────────────────────────
      const usrs = await db.execute(sql`
        SELECT id, name, email, role
        FROM users
        WHERE empresa_id = ${tenantId}
          AND (LOWER(name) LIKE ${term} OR LOWER(email) LIKE ${term})
        LIMIT 5
      `);
      for (const u of usrs.rows) {
        results.push({ id: u.id, label: u.name as string, sublabel: u.email as string, href: '/admin/users', category: 'Usuários' });
      }

      // NOTE: companies, orders, and fiscal_invoices do not have an empresa_id
      // discriminator column and therefore cannot be safely scoped to the current
      // tenant without a schema migration. They are intentionally excluded from
      // search results to prevent cross-tenant data leakage.

      res.json({ results, total: results.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
