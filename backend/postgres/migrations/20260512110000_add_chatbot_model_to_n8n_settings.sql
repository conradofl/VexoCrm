-- Adiciona chatbot_model em lead_client_n8n_settings
-- Permite configurar qual modelo de chatbot cada empresa usa

ALTER TABLE lead_client_n8n_settings
  ADD COLUMN IF NOT EXISTS chatbot_model VARCHAR(64) NOT NULL DEFAULT 'outlier';

COMMENT ON COLUMN lead_client_n8n_settings.chatbot_model IS 'Modelo de chatbot ativo para esta empresa (ex: outlier, infine)';
