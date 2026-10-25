-- Migration: 20261024150000_add_dispatch_options_and_dispatch_id.sql
-- 1. Congelar dispatch_options no lote de disparo
ALTER TABLE public.campaign_dispatches
ADD COLUMN IF NOT EXISTS dispatch_options JSONB DEFAULT '{}'::jsonb;

-- 2. Gravar dispatch_id em lead_messages (passos subsequentes e handoff rastreáveis)
ALTER TABLE public.lead_messages
ADD COLUMN IF NOT EXISTS dispatch_id UUID REFERENCES public.campaign_dispatches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lead_messages_dispatch_id
ON public.lead_messages (client_id, dispatch_id)
WHERE dispatch_id IS NOT NULL;
