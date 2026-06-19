-- Adiciona coluna allowed_tabs em lead_client_n8n_settings
ALTER TABLE public.lead_client_n8n_settings
  ADD COLUMN IF NOT EXISTS allowed_tabs JSONB DEFAULT NULL;

COMMENT ON COLUMN public.lead_client_n8n_settings.allowed_tabs IS 'Lista de abas e sub-abas liberadas para visualização da empresa';
