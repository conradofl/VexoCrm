-- Adiciona colunas para fatiamento de leads (lotes) na tabela de disparos
ALTER TABLE public.campaign_dispatches
  ADD COLUMN IF NOT EXISTS limit_per_run INTEGER,
  ADD COLUMN IF NOT EXISTS "offset" INTEGER;
