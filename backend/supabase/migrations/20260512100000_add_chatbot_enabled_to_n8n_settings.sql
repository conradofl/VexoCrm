-- Adiciona coluna chatbot_enabled em lead_client_n8n_settings
-- Permite habilitar/desabilitar o chatbot por tenant sem remover a configuração

ALTER TABLE lead_client_n8n_settings
  ADD COLUMN IF NOT EXISTS chatbot_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN lead_client_n8n_settings.chatbot_enabled IS 'Habilita ou desabilita o chatbot SPIN para esta empresa';
