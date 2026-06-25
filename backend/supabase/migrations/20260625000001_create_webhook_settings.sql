CREATE TABLE IF NOT EXISTS public.webhook_settings (
  client_id TEXT PRIMARY KEY REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  inbound_token TEXT NOT NULL,
  conversion_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.webhook_settings ENABLE ROW LEVEL SECURITY;

-- Read: authenticated can read
CREATE POLICY "Allow read webhook_settings"
  ON public.webhook_settings FOR SELECT
  USING (true);

-- Insert/Update: authenticated users can manage
CREATE POLICY "Allow all webhook_settings"
  ON public.webhook_settings FOR ALL
  USING (true);
