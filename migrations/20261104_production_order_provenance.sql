-- Fase 1: trusted order origin and idempotent contractual occurrence provenance.
-- Legacy orders remain NULL; no origin is backfilled from is_recurring or notes.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS production_origin TEXT;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_production_origin_check
    CHECK (production_origin IS NULL OR production_origin IN ('FREE', 'CONTRACT_FIXED', 'SPECIAL'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE special_order_requests
  ADD COLUMN IF NOT EXISTS generated_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS special_order_requests_generated_order_unique
  ON special_order_requests(generated_order_id)
  WHERE generated_order_id IS NOT NULL;

ALTER TABLE recurring_order_logs
  ADD COLUMN IF NOT EXISTS contract_id INTEGER REFERENCES contratos_clientes(id),
  ADD COLUMN IF NOT EXISTS delivery_date DATE;

-- The occurrence key is enforced by PostgreSQL, not just by a preflight query.
-- If legacy duplicates exist, index creation fails safely and must be reviewed;
-- this migration never chooses or deletes historical records.
CREATE UNIQUE INDEX IF NOT EXISTS recurring_order_logs_unique_week_day
  ON recurring_order_logs(company_id, week_key, day_of_week);

-- New cron executions write this row in the same transaction as the order.
-- Existing rows without contract/date are deliberately untrusted.
CREATE TABLE IF NOT EXISTS recurring_order_log_items (
  id SERIAL PRIMARY KEY,
  recurring_order_log_id INTEGER NOT NULL
    REFERENCES recurring_order_logs(id) ON DELETE CASCADE,
  contract_scope_id INTEGER NOT NULL REFERENCES contract_scopes(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT recurring_order_log_items_scope_unique
    UNIQUE (recurring_order_log_id, contract_scope_id),
  CONSTRAINT recurring_order_log_items_order_item_unique
    UNIQUE (order_item_id)
);

CREATE INDEX IF NOT EXISTS recurring_order_logs_contract_date_idx
  ON recurring_order_logs(contract_id, delivery_date);

CREATE INDEX IF NOT EXISTS recurring_order_log_items_scope_idx
  ON recurring_order_log_items(contract_scope_id);

CREATE INDEX IF NOT EXISTS orders_production_eligibility_idx
  ON orders(delivery_date, workflow_status, production_origin);

ALTER TABLE recurring_order_log_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE recurring_order_log_items FROM anon, authenticated;
REVOKE ALL ON SEQUENCE recurring_order_log_items_id_seq FROM anon, authenticated;
