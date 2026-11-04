-- Product production classification, auditable aliases, and order-time
-- description snapshots.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS production_classification TEXT;

DO $$ BEGIN
  ALTER TABLE products
    ADD CONSTRAINT products_production_classification_check
    CHECK (production_classification IS NULL OR production_classification IN ('IN_NATURA', 'PROCESSADOS'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS source_description_snapshot TEXT;

CREATE TABLE IF NOT EXISTS product_aliases (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  company_id INTEGER REFERENCES companies(id),
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  global_justification TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIRMED'
    CHECK (status IN ('CONFIRMED', 'REVOKED')),
  confirmed_by_user_id INTEGER NOT NULL REFERENCES users(id),
  confirmed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  revoked_by_user_id INTEGER REFERENCES users(id),
  revoked_at TIMESTAMP,
  revocation_reason TEXT,
  CONSTRAINT product_aliases_global_justification_check
    CHECK (company_id IS NOT NULL OR length(trim(coalesce(global_justification, ''))) >= 20)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_aliases_company_normalized_unique
  ON product_aliases(company_id, normalized_alias)
  WHERE company_id IS NOT NULL AND status = 'CONFIRMED';

CREATE UNIQUE INDEX IF NOT EXISTS product_aliases_global_normalized_unique
  ON product_aliases(normalized_alias)
  WHERE company_id IS NULL AND status = 'CONFIRMED';

CREATE INDEX IF NOT EXISTS product_aliases_product_idx
  ON product_aliases(product_id);

CREATE INDEX IF NOT EXISTS product_aliases_company_idx
  ON product_aliases(company_id);

-- Alias data is accessed by the server through its trusted PostgreSQL
-- connection. Keep Supabase Data API roles from reading or changing it.
ALTER TABLE product_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE product_aliases FROM anon, authenticated;
REVOKE ALL ON SEQUENCE product_aliases_id_seq FROM anon, authenticated;
