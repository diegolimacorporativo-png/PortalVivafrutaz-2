/**
 * Seed: Ambiente Controlado de Teste
 *
 * Popula o banco com dados reais para validação de:
 *   - Frontend (catálogo)
 *   - Pricing (basePrice + subCategory + adminFee)
 *   - Pedidos
 *   - Timeline
 *
 * Idempotente: pode ser executado várias vezes sem duplicar dados
 * (faz cleanup das entidades de teste antes de inserir).
 *
 * Uso:
 *   npx tsx script/seed-test-env.ts
 */
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COMPANY_NAME = "Empresa Teste";
const COMPANY_EMAIL = "cliente@test.com";
const COMPANY_PASSWORD = "cliente123";
const ADMIN_EMAIL = "admin@test.com";
const ADMIN_PASSWORD = "admin123";

const TEST_PRODUCT_NAMES = [
  "Banana Teste",
  "Maçã Teste",
  "Melão Teste",
  "Produto Sem Preço",
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── CLEANUP (idempotência) ───────────────────────────────────────────
    // Remove qualquer dado anterior com os mesmos identificadores de teste.
    const oldCompany = await client.query(
      "SELECT id FROM companies WHERE email = $1 OR company_name = $2",
      [COMPANY_EMAIL, COMPANY_NAME],
    );
    if (oldCompany.rowCount && oldCompany.rowCount > 0) {
      const ids = oldCompany.rows.map((r) => r.id);
      console.log(`[CLEANUP] Removendo empresa(s) de teste anteriores: ${ids.join(", ")}`);
      // Remove dependências: pedidos -> itens, sub-categorias dos produtos da empresa
      const oldProducts = await client.query(
        "SELECT id FROM products WHERE empresa_id = ANY($1::int[])",
        [ids],
      );
      const oldProductIds = oldProducts.rows.map((r) => r.id);
      if (oldProductIds.length) {
        await client.query(
          "DELETE FROM product_sub_categories WHERE product_id = ANY($1::int[])",
          [oldProductIds],
        );
        await client.query(
          "DELETE FROM order_items WHERE product_id = ANY($1::int[])",
          [oldProductIds],
        );
        await client.query(
          "DELETE FROM products WHERE id = ANY($1::int[])",
          [oldProductIds],
        );
      }
      await client.query(
        "DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE company_id = ANY($1::int[]))",
        [ids],
      );
      await client.query("DELETE FROM orders WHERE company_id = ANY($1::int[])", [ids]);
      await client.query("DELETE FROM contract_scopes WHERE company_id = ANY($1::int[])", [ids]);
      await client.query("DELETE FROM users WHERE empresa_id = ANY($1::int[]) OR email = $2", [ids, ADMIN_EMAIL]);
      await client.query("DELETE FROM companies WHERE id = ANY($1::int[])", [ids]);
    } else {
      // Pode ainda existir um admin de teste sem empresa associada.
      await client.query("DELETE FROM users WHERE email = $1", [ADMIN_EMAIL]);
    }

    // ── STEP 1 — CRIAR EMPRESA ───────────────────────────────────────────
    const allDays = JSON.stringify([
      "Segunda-feira",
      "Terça-feira",
      "Quarta-feira",
      "Quinta-feira",
      "Sexta-feira",
      "Sábado",
      "Domingo",
    ]);
    const companyResult = await client.query(
      `INSERT INTO companies
        (company_name, contact_name, email, password, allowed_order_days,
         use_new_pricing, admin_fee, active, client_type)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, true, 'mensal')
       RETURNING id`,
      [
        COMPANY_NAME,
        "Contato Teste",
        COMPANY_EMAIL,
        COMPANY_PASSWORD, // texto puro — auto-upgrade para bcrypt no 1º login
        allDays,
        true,
        10,
      ],
    );
    const companyId: number = companyResult.rows[0].id;
    console.log(`[STEP 1] Empresa criada: ${COMPANY_NAME} (id=${companyId})`);

    // ── STEP 2 — CRIAR USUÁRIOS ──────────────────────────────────────────
    // ADMIN — vai na tabela users (login via /api/auth/login type=admin).
    const adminResult = await client.query(
      `INSERT INTO users (empresa_id, name, email, password, role, active)
       VALUES ($1, $2, $3, $4, 'ADMIN', true)
       RETURNING id`,
      [companyId, "Admin Teste", ADMIN_EMAIL, ADMIN_PASSWORD],
    );
    console.log(`[STEP 2] ADMIN criado: ${ADMIN_EMAIL} (id=${adminResult.rows[0].id}) — senha: ${ADMIN_PASSWORD}`);
    // CLIENTE — neste sistema o cliente é a própria empresa (login email = ${COMPANY_EMAIL}).
    console.log(`[STEP 2] CLIENTE = empresa (${COMPANY_EMAIL}) — senha: ${COMPANY_PASSWORD}`);

    // ── STEP 3 — CRIAR PRODUTOS ──────────────────────────────────────────
    // PRODUTO A — Banana Teste (basePrice 10)
    const banana = await client.query(
      `INSERT INTO products (empresa_id, name, category, unit, base_price, active)
       VALUES ($1, $2, 'Frutas', 'KG', $3, true)
       RETURNING id`,
      [companyId, "Banana Teste", 10],
    );
    console.log(`[STEP 3A] Banana Teste (id=${banana.rows[0].id}) — basePrice R$ 10`);

    // PRODUTO B — Maçã Teste (sem basePrice, usa sub-categorias)
    const maca = await client.query(
      `INSERT INTO products (empresa_id, name, category, unit, base_price, active)
       VALUES ($1, $2, 'Frutas', 'KG', NULL, true)
       RETURNING id`,
      [companyId, "Maçã Teste"],
    );
    const macaId: number = maca.rows[0].id;
    await client.query(
      `INSERT INTO product_sub_categories (empresa_id, product_id, category_name, price, active)
       VALUES ($1, $2, 'Pequeno', 8, true), ($1, $2, 'Grande', 12, true)`,
      [companyId, macaId],
    );
    console.log(`[STEP 3B] Maçã Teste (id=${macaId}) — Pequeno R$ 8 / Grande R$ 12`);

    // PRODUTO C — Melão Teste (basePrice 20, subCategory 18)
    const melao = await client.query(
      `INSERT INTO products (empresa_id, name, category, unit, base_price, active)
       VALUES ($1, $2, 'Frutas', 'KG', $3, true)
       RETURNING id`,
      [companyId, "Melão Teste", 20],
    );
    const melaoId: number = melao.rows[0].id;
    await client.query(
      `INSERT INTO product_sub_categories (empresa_id, product_id, category_name, price, active)
       VALUES ($1, $2, 'Padrão', 18, true)`,
      [companyId, melaoId],
    );
    console.log(`[STEP 3C] Melão Teste (id=${melaoId}) — basePrice R$ 20 / subCategory R$ 18`);

    // PRODUTO D — Sem preço (edge case)
    const semPreco = await client.query(
      `INSERT INTO products (empresa_id, name, category, unit, base_price, active)
       VALUES ($1, $2, 'Frutas', 'KG', NULL, true)
       RETURNING id`,
      [companyId, "Produto Sem Preço"],
    );
    console.log(`[STEP 3D] Produto Sem Preço (id=${semPreco.rows[0].id}) — sem preço (edge case)`);

    await client.query("COMMIT");

    console.log("\n✅ AMBIENTE CONTROLADO CRIADO COM SUCESSO\n");
    console.log("───────────────────────────────────────────────");
    console.log("CREDENCIAIS DE TESTE");
    console.log("───────────────────────────────────────────────");
    console.log(`  CLIENTE  → email: ${COMPANY_EMAIL}   senha: ${COMPANY_PASSWORD}`);
    console.log(`  ADMIN    → email: ${ADMIN_EMAIL}    senha: ${ADMIN_PASSWORD}`);
    console.log("───────────────────────────────────────────────");
    console.log("PREÇOS ESPERADOS NO CLIENTE (com adminFee 10%)");
    console.log("───────────────────────────────────────────────");
    console.log("  Banana Teste                R$ 10.00 → R$ 11.00");
    console.log("  Maçã Teste (Pequeno)        R$  8.00 → R$  8.80");
    console.log("  Maçã Teste (Grande)         R$ 12.00 → R$ 13.20");
    console.log("  Melão Teste (subCategory)   R$ 18.00 → R$ 19.80");
    console.log("  Produto Sem Preço           — (não deve aparecer)");
    console.log("───────────────────────────────────────────────\n");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao popular ambiente de teste:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
