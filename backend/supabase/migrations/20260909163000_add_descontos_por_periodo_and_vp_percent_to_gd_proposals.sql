-- Migration 20260909163000: Adiciona colunas descontos_por_periodo e vp_percent na tabela public.gd_proposals
-- Idempotente: ADD COLUMN IF NOT EXISTS

ALTER TABLE public.gd_proposals
  ADD COLUMN IF NOT EXISTS descontos_por_periodo JSONB NULL,
  ADD COLUMN IF NOT EXISTS vp_percent NUMERIC NULL;
