-- Migration: 20261011183000_add_stalled_notifications_synced_at.sql
-- Pilar 1: Suporte a controle diário de notificações de leads parados

ALTER TABLE public.lead_client_n8n_settings
  ADD COLUMN IF NOT EXISTS stalled_notifications_synced_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_n8n_settings_stalled_notifications_synced_at
  ON public.lead_client_n8n_settings (stalled_notifications_synced_at);
