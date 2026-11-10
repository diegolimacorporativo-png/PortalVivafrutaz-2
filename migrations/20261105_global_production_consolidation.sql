-- Phase 2: one global production batch per delivery date.
-- Existing tenant-scoped batches are preserved and are not rewritten.

ALTER TABLE production_batch_items
  ADD COLUMN IF NOT EXISTS production_classification TEXT;

DO $$ BEGIN
  ALTER TABLE production_batch_items
    ADD CONSTRAINT production_batch_items_classification_check
    CHECK (production_classification IS NULL OR production_classification IN ('IN_NATURA', 'PROCESSADOS'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A global batch is represented by empresa_id IS NULL. This database
-- constraint is the concurrency/idempotency guard for repeated generation.
-- Do not select or delete historical duplicates automatically: stop with an
-- explicit diagnostic so an operator can review the affected dates first.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM production_batches
    WHERE empresa_id IS NULL
    GROUP BY production_date
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate global production batches exist by production_date; review them before applying production_batches_global_date_unique.'
      USING ERRCODE = '23505';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS production_batches_global_date_unique
  ON production_batches(production_date)
  WHERE empresa_id IS NULL;
