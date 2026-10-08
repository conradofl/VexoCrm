-- Migration: 20261008170000_add_reactivation_settings_to_n8n_settings.sql
-- Pilar 2: Reativação Automática de Leads Parados (Cadência de Resgate Automático)
-- Suporte às configurações por cliente na tabela public.lead_client_n8n_settings

ALTER TABLE public.lead_client_n8n_settings
  ADD COLUMN IF NOT EXISTS reactivation_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS reactivation_stalled_days INT DEFAULT 7,
  ADD COLUMN IF NOT EXISTS reactivation_cadence_id UUID NULL,
  ADD COLUMN IF NOT EXISTS reactivation_cooldown_days INT DEFAULT 30;

CREATE INDEX IF NOT EXISTS idx_n8n_settings_reactivation_enabled
  ON public.lead_client_n8n_settings (reactivation_enabled)
  WHERE reactivation_enabled = true;
