-- Adiciona tenant_id que estava faltando na tabela followup_companies
-- (provavelmente esquecido em um commit anterior).

ALTER TABLE public.followup_companies
ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Backfill para a empresa LivPub já existente
UPDATE public.followup_companies
SET tenant_id = 'livpub'
WHERE tenant_id IS NULL AND name ILIKE '%liv%';
