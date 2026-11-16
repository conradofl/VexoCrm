-- Gestor de Tráfego, PR 4a: de qual anúncio o lead veio.
--
-- Uma linha por chegada com origem registrada (formulário do site hoje; a
-- conversa do WhatsApp que nasce de anúncio entra depois). Lead sem linha aqui
-- é lead "sem registro" de origem: nada é deduzido nem preenchido por padrão.
--
-- Só leitura de anúncio: nenhuma coluna aqui altera campanha, verba ou anúncio.

CREATE TABLE IF NOT EXISTS public.lead_ad_origins (
  id bigserial PRIMARY KEY,
  client_id text NOT NULL,
  -- Apagar o lead apaga a origem dele (LGPD), como em landing_page_sessions.
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  phone text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('site', 'whatsapp')),
  platform text CHECK (platform IS NULL OR platform IN ('meta', 'google')),
  -- true só com prova de anúncio pago (gclid, identificador do anúncio ou
  -- utm_medium de mídia paga). fbclid sozinho NÃO é prova: o Facebook põe
  -- fbclid em link de post orgânico também.
  paid boolean NOT NULL DEFAULT false,
  campaign_id text,
  adset_id text,
  ad_id text,
  click_id text,
  click_id_type text CHECK (click_id_type IS NULL OR click_id_type IN ('fbclid', 'gclid', 'gbraid', 'wbraid', 'ctwa_clid')),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_path text,
  referrer_host text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);

-- Indicadores por anúncio (leads, respostas, reuniões) cruzam com
-- traffic_metrics_daily.ad_id.
CREATE INDEX IF NOT EXISTS lead_ad_origins_client_ad_idx
  ON public.lead_ad_origins (client_id, ad_id, captured_at DESC)
  WHERE ad_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS lead_ad_origins_lead_idx
  ON public.lead_ad_origins (lead_id)
  WHERE lead_id IS NOT NULL;
