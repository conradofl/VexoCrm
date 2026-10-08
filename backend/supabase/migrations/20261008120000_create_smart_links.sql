-- Tabela de smart links encurtados com rastreamento individual por lead e campanha
CREATE TABLE IF NOT EXISTS public.smart_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  destination_url TEXT NOT NULL,
  title TEXT,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  dispatch_id UUID,
  clicks_count INT NOT NULL DEFAULT 0,
  first_clicked_at TIMESTAMPTZ,
  last_clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_smart_links_code ON public.smart_links(code);
CREATE INDEX IF NOT EXISTS idx_smart_links_tenant_lead ON public.smart_links(client_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_smart_links_tenant_camp ON public.smart_links(client_id, campaign_id);

-- Tabela de log analítico e telemetria de cliques em smart links
CREATE TABLE IF NOT EXISTS public.smart_link_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES public.smart_links(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  lead_id UUID,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  referrer TEXT,
  device_type TEXT DEFAULT 'mobile'
);

CREATE INDEX IF NOT EXISTS idx_smart_link_clicks_tenant ON public.smart_link_clicks(client_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_smart_link_clicks_link ON public.smart_link_clicks(link_id, clicked_at DESC);
