-- Migration 20260918100000: sdr_distribution em lead_client_n8n_settings
-- "todos" (padrão, comportamento de hoje) ou "rodizio" (um consultor por vez,
-- decisão fixada por lead em leads.dados.sdr_rotation_owner).

ALTER TABLE lead_client_n8n_settings
  ADD COLUMN IF NOT EXISTS sdr_distribution TEXT NOT NULL DEFAULT 'todos';

ALTER TABLE lead_client_n8n_settings
  DROP CONSTRAINT IF EXISTS lead_client_n8n_settings_sdr_distribution_check;

ALTER TABLE lead_client_n8n_settings
  ADD CONSTRAINT lead_client_n8n_settings_sdr_distribution_check
  CHECK (sdr_distribution IN ('todos', 'rodizio'));
