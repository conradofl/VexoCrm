-- Migration: 20260909171000_add_stage_source_and_lost_reason_to_leads.sql
-- Adiciona stage_source (manual, auto, integration) e lost_reason a public.leads

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS stage_source TEXT NULL,
  ADD COLUMN IF NOT EXISTS lost_reason TEXT NULL;

COMMENT ON COLUMN public.leads.stage_source IS 'Origem do estágio do funil: manual (usuário na tela), auto (classificação automática/extração), integration (webhook de conversão). Se for manual, não pode ser sobrescrito por processos automáticos.';
COMMENT ON COLUMN public.leads.lost_reason IS 'Motivo da perda do lead (preço, prazo, comprou de outro, sumiu, não era o perfil, outro) quando stage = lost.';
