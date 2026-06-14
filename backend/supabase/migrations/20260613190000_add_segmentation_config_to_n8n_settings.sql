ALTER TABLE public.lead_client_n8n_settings
  ADD COLUMN IF NOT EXISTS segmentation_config JSONB NOT NULL DEFAULT '{"version":1,"kpis":[]}'::jsonb;

COMMENT ON COLUMN public.lead_client_n8n_settings.segmentation_config
  IS 'Configuração de KPIs/campos de segmentação por empresa/tenant.';
