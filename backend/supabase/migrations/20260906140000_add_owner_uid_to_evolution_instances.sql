-- Migration 20260906140000: Adiciona coluna owner_uid na tabela de instâncias Evolution (chips WhatsApp)
-- Idempotente: ADD COLUMN IF NOT EXISTS e CREATE INDEX IF NOT EXISTS

ALTER TABLE public.lead_client_evolution_instances
  ADD COLUMN IF NOT EXISTS owner_uid TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_client_evolution_owner_uid
  ON public.lead_client_evolution_instances (client_id, owner_uid);
