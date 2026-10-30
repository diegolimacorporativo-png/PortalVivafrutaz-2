-- Explicit, idempotent replacement for schema DDL previously executed at
-- application startup. Review the target database and take a verified backup
-- before applying this file with the documented operator procedure.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS recurring_order_logs (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  week_key TEXT NOT NULL,
  day_of_week TEXT NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  scope_count INTEGER NOT NULL DEFAULT 0,
  total_value NUMERIC(10,2),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS recurring_order_logs_unique_week_day
  ON recurring_order_logs(company_id, week_key, day_of_week);

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;

-- connect-pg-simple no longer creates this table automatically at runtime.
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
