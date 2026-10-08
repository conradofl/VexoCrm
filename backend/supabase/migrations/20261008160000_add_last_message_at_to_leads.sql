-- Migration: 20261008160000_add_last_message_at_to_leads.sql
-- Adiciona coluna last_message_at em public.leads para rastreamento de inatividade (Pilar 1)

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_last_message_at ON public.leads (client_id, last_message_at);
