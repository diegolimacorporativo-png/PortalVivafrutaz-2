-- Migration: add empresa_id to users and companies for multi-tenant compatibility
ALTER TABLE users ADD COLUMN IF NOT EXISTS empresa_id TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS empresa_id TEXT;

-- Backfill minimal safe value
UPDATE users SET empresa_id = '1' WHERE empresa_id IS NULL;
UPDATE companies SET empresa_id = '1' WHERE empresa_id IS NULL;
