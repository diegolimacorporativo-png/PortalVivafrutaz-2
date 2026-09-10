-- Etapa 35: recovery tokens must not remain reversible/plaintext in storage.
-- This migration intentionally invalidates all existing recovery links. There
-- is no safe way to derive a digest from a plaintext token without preserving
-- or exposing that secret, and recovery links are short-lived capabilities.
ALTER TABLE public.password_reset_tokens
  ADD COLUMN token_hash text;

DELETE FROM public.password_reset_tokens;

ALTER TABLE public.password_reset_tokens
  DROP CONSTRAINT IF EXISTS password_reset_tokens_token_unique;

ALTER TABLE public.password_reset_tokens
  DROP COLUMN token;

ALTER TABLE public.password_reset_tokens
  ALTER COLUMN token_hash SET NOT NULL;

ALTER TABLE public.password_reset_tokens
  ADD CONSTRAINT password_reset_tokens_token_hash_unique UNIQUE (token_hash);