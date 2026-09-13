-- Migration: Condições de saída da cadência de follow-up gravadas por campanha
-- ETAPA 1: exit_on_reply, exit_on_won, exit_on_lost, exit_on_human_takeover

ALTER TABLE public.followup_campaigns
  ADD COLUMN IF NOT EXISTS exit_on_reply BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS exit_on_won BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS exit_on_lost BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS exit_on_human_takeover BOOLEAN NOT NULL DEFAULT TRUE;

-- Garante que todas as campanhas existentes fiquem com as condições ligadas por padrão
UPDATE public.followup_campaigns
SET
  exit_on_reply = COALESCE(exit_on_reply, TRUE),
  exit_on_won = COALESCE(exit_on_won, TRUE),
  exit_on_lost = COALESCE(exit_on_lost, TRUE),
  exit_on_human_takeover = COALESCE(exit_on_human_takeover, TRUE);
