import { db } from "../server/database/db";
import { sql } from "drizzle-orm";

async function migrate() {
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT false`);
  console.log("✓ is_recurring adicionado");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS recurring_order_logs (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      week_key TEXT NOT NULL,
      day_of_week TEXT NOT NULL,
      order_id INTEGER REFERENCES orders(id),
      scope_count INTEGER NOT NULL DEFAULT 0,
      total_value NUMERIC(10,2),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log("✓ recurring_order_logs criada");

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS recurring_order_logs_unique_week_day
      ON recurring_order_logs(company_id, week_key, day_of_week)
  `);
  console.log("✓ índice único criado");
  process.exit(0);
}

migrate().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
