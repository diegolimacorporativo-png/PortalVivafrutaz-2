-- T1002 — NF-e atomic sequence
-- Creates a PostgreSQL sequence for NF-e numbering that replaces the
-- non-atomic MAX(numero)+1 pattern. Safe for concurrent emission and
-- batch (Promise.all) scenarios. Idempotent: runs without error even
-- if the sequence already exists.
--
-- Initialization: starts at MAX(numero::integer)+1 from existing rows,
-- so all historical numbers are preserved and no gaps are introduced.

DO $$
DECLARE
  max_num INTEGER;
BEGIN
  -- Safely find current max; COALESCE handles an empty table (returns 1).
  SELECT COALESCE(MAX(
    CASE WHEN numero ~ '^[0-9]+$' THEN numero::integer ELSE 0 END
  ), 0) + 1
    INTO max_num
  FROM nfe_emissoes;

  -- Only create if it does not already exist (full idempotency).
  IF NOT EXISTS (
    SELECT 1 FROM pg_sequences WHERE sequencename = 'nfe_numero_seq'
  ) THEN
    EXECUTE format('CREATE SEQUENCE nfe_numero_seq START %s', max_num);
    RAISE NOTICE 'nfe_numero_seq created, starting at %', max_num;
  ELSE
    RAISE NOTICE 'nfe_numero_seq already exists — skipping creation';
  END IF;
END;
$$;
