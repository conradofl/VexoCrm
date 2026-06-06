-- Campanhas com período de duração e disparos independentes.
-- Campaigns passam a ter starts_at / ends_at definindo o período ativo.
-- Dentro do período qualquer lead da campanha usa prompt tipo "campanha".
-- Disparos (campaign_dispatches) são ações de envio dentro do período — manuais ou agendados.

-- 1. Adiciona período de duração à tabela campaigns
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS starts_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS chatbot_prompt_type TEXT NOT NULL DEFAULT 'campanha';

-- Índice para busca rápida de campanhas ativas no momento
CREATE INDEX IF NOT EXISTS idx_campaigns_period
  ON public.campaigns (client_id, starts_at, ends_at)
  WHERE archived_at IS NULL;

-- 2. Nova tabela campaign_dispatches
-- Cada disparo é uma ação de envio dentro de uma campanha.
-- steps: array jsonb com os passos (texto, imagem, etc.) — mesma estrutura atual do analytics_meta.steps
CREATE TABLE IF NOT EXISTS public.campaign_dispatches (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  client_id       TEXT        NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL DEFAULT '',
  steps           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  trigger_type    TEXT        NOT NULL DEFAULT 'manual'
                  CHECK (trigger_type IN ('manual', 'scheduled')),
  scheduled_at    TIMESTAMPTZ,
  status          TEXT        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'scheduled', 'running', 'done', 'failed', 'cancelled')),
  sent_count      INTEGER     NOT NULL DEFAULT 0,
  failed_count    INTEGER     NOT NULL DEFAULT 0,
  triggered_at    TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_dispatches_campaign
  ON public.campaign_dispatches (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_dispatches_scheduled
  ON public.campaign_dispatches (status, scheduled_at)
  WHERE status IN ('scheduled') AND scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_dispatches_client
  ON public.campaign_dispatches (client_id, created_at DESC);

ALTER TABLE public.campaign_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all direct access to campaign_dispatches" ON public.campaign_dispatches;
CREATE POLICY "Deny all direct access to campaign_dispatches"
  ON public.campaign_dispatches FOR ALL USING (false);

-- 3. Log de execuções de cada disparo (equivalente ao campaign_dispatch_logs existente mas por dispatch)
CREATE TABLE IF NOT EXISTS public.campaign_dispatch_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id     UUID        NOT NULL REFERENCES public.campaign_dispatches(id) ON DELETE CASCADE,
  campaign_id     UUID        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  client_id       TEXT        NOT NULL,
  phone           TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_dispatch_runs_dispatch
  ON public.campaign_dispatch_runs (dispatch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_dispatch_runs_phone
  ON public.campaign_dispatch_runs (client_id, phone);

ALTER TABLE public.campaign_dispatch_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all direct access to campaign_dispatch_runs" ON public.campaign_dispatch_runs;
CREATE POLICY "Deny all direct access to campaign_dispatch_runs"
  ON public.campaign_dispatch_runs FOR ALL USING (false);
