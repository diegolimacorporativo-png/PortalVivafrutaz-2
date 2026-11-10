import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../migrations/20261104_production_order_provenance.sql", import.meta.url),
  "utf8",
);
const globalProductionMigration = readFileSync(
  new URL("../../migrations/20261105_global_production_consolidation.sql", import.meta.url),
  "utf8",
);

test("migration persists trusted origins without backfilling legacy orders", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS production_origin TEXT/i);
  assert.match(migration, /production_origin IN \('FREE', 'CONTRACT_FIXED', 'SPECIAL'\)/i);
  assert.doesNotMatch(migration, /UPDATE\s+orders\s+SET\s+production_origin/i);
});

test("contract occurrence is unique in PostgreSQL and linked to exact materialized items", () => {
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS recurring_order_logs_unique_week_day\s+ON recurring_order_logs\(company_id, week_key, day_of_week\)/i);
  assert.match(migration, /contract_id INTEGER REFERENCES contratos_clientes\(id\)/i);
  assert.match(migration, /delivery_date DATE/i);
  assert.match(migration, /recurring_order_log_id INTEGER NOT NULL\s+REFERENCES recurring_order_logs\(id\)/i);
  assert.match(migration, /contract_scope_id INTEGER NOT NULL REFERENCES contract_scopes\(id\)/i);
  assert.match(migration, /order_item_id INTEGER NOT NULL REFERENCES order_items\(id\)/i);
  assert.match(migration, /UNIQUE \(recurring_order_log_id, contract_scope_id\)/i);
  assert.match(migration, /UNIQUE \(order_item_id\)/i);
});

test("occurrence provenance table is not exposed to Supabase client roles", () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE ALL ON TABLE recurring_order_log_items FROM anon, authenticated/i);
  assert.match(migration, /REVOKE ALL ON SEQUENCE recurring_order_log_items_id_seq FROM anon, authenticated/i);
});

test("migration global cria unicidade por data e snapshot da classificação, sem mexer em registros", () => {
  assert.match(globalProductionMigration, /ADD COLUMN IF NOT EXISTS production_classification TEXT/i);
  assert.match(globalProductionMigration, /production_classification IN \('IN_NATURA', 'PROCESSADOS'\)/i);
  assert.match(globalProductionMigration, /UNIQUE INDEX IF NOT EXISTS production_batches_global_date_unique\s+ON production_batches\(production_date\)\s+WHERE empresa_id IS NULL/i);
  assert.doesNotMatch(globalProductionMigration, /UPDATE\s+(orders|order_items|contract_scopes|production_batches)/i);
});
