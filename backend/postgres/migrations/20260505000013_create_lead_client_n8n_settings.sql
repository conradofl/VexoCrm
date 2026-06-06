CREATE TABLE IF NOT EXISTS public.lead_client_n8n_settings (
  client_id TEXT PRIMARY KEY REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  dispatch_webhook_url TEXT,
  dispatch_webhook_token TEXT,
  inbound_bearer_token TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_uid TEXT,
  updated_by_email TEXT
);

CREATE INDEX IF NOT EXISTS idx_lead_client_n8n_settings_active
  ON public.lead_client_n8n_settings (active);

ALTER TABLE public.lead_client_n8n_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all direct access to lead_client_n8n_settings"
ON public.lead_client_n8n_settings;

CREATE POLICY "Deny all direct access to lead_client_n8n_settings"
ON public.lead_client_n8n_settings
FOR ALL
USING (false);
