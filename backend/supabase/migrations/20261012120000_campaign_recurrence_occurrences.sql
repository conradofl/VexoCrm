-- Campanha recorrente pelo caminho da fila (campaign_dispatches) — Bloco 3.
--
-- Reusa os campos de recorrencia que ja existem em campaigns (20261008180000): is_recurring, recurrence_pattern,
-- recurrence_day_of_month, recurrence_day_of_week, recurrence_time, next_run_at. Aqui so entra o que faltava:
-- fim declarado, contador de ocorrencias, a marca de "esta linha de lote e uma ocorrencia" e o registro de cada
-- ocorrencia (criada ou pulada, com o motivo).

-- 1. Fim declarado e contador
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS recurrence_end_type TEXT,
  ADD COLUMN IF NOT EXISTS recurrence_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recurrence_max_occurrences INT,
  ADD COLUMN IF NOT EXISTS recurrence_occurrences_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recurrence_ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recurrence_no_end_confirmed_at TIMESTAMPTZ;

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_recurrence_end_type_check;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_recurrence_end_type_check
  CHECK (recurrence_end_type IS NULL OR recurrence_end_type IN ('until_date', 'count', 'never'));

COMMENT ON COLUMN public.campaigns.recurrence_end_type IS 'Fim declarado da recorrencia: until_date, count ou never';
COMMENT ON COLUMN public.campaigns.recurrence_ends_at IS 'Fim por data: nenhuma ocorrencia depois deste instante';
COMMENT ON COLUMN public.campaigns.recurrence_max_occurrences IS 'Fim por contagem: total de ocorrencias criadas (puladas nao contam)';
COMMENT ON COLUMN public.campaigns.recurrence_occurrences_count IS 'Ocorrencias criadas ate agora (puladas nao contam)';
COMMENT ON COLUMN public.campaigns.recurrence_ended_at IS 'Quando a recorrencia terminou pelo fim declarado; next_run_at fica NULL';
COMMENT ON COLUMN public.campaigns.recurrence_no_end_confirmed_at IS 'Confirmacao explicita do dono para recorrencia sem fim';

-- 2. Colunas que o lote precisa e que hoje so nascem por ALTER em tempo de execucao (ensureCampaignDispatch*).
--    Idempotente: em producao ja existem.
ALTER TABLE public.campaign_dispatches
  ADD COLUMN IF NOT EXISTS evolution_instance_id UUID,
  ADD COLUMN IF NOT EXISTS target_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatch_options JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS recurrence_occurrence_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recurrence_variant_offset INT;

COMMENT ON COLUMN public.campaign_dispatches.recurrence_occurrence_at IS 'Horario da ocorrencia recorrente que gerou este lote; NULL = lote manual/agendado avulso';
COMMENT ON COLUMN public.campaign_dispatches.recurrence_variant_offset IS 'Ordem da ocorrencia (1, 2, ...): desloca a variacao do texto por lead, para o mesmo lead nao receber o mesmo texto duas vezes seguidas';

-- 3. Trava por campanha, garantida pelo banco: duas ocorrencias da MESMA campanha nunca ficam em running juntas.
--    O claim do agendador protege a linha; isto protege a campanha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_dispatches_one_running_occurrence
  ON public.campaign_dispatches (campaign_id)
  WHERE status = 'running' AND recurrence_occurrence_at IS NOT NULL;

-- 4. Registro de cada ocorrencia. Ocorrencia pulada aparece aqui com o motivo — senao o dono acha que foi enviada.
CREATE TABLE IF NOT EXISTS public.campaign_recurrence_occurrences (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  client_id      TEXT        NOT NULL,
  occurrence_at  TIMESTAMPTZ NOT NULL,
  outcome        TEXT        NOT NULL CHECK (outcome IN ('created', 'skipped')),
  reason         TEXT,
  dispatch_id    UUID        REFERENCES public.campaign_dispatches(id) ON DELETE SET NULL,
  audience_count INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, occurrence_at)
);

CREATE INDEX IF NOT EXISTS idx_campaign_recurrence_occurrences_campaign
  ON public.campaign_recurrence_occurrences (campaign_id, occurrence_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaigns_recurring_due
  ON public.campaigns (next_run_at)
  WHERE is_recurring = true AND archived_at IS NULL AND next_run_at IS NOT NULL;

ALTER TABLE public.campaign_recurrence_occurrences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all direct access to campaign_recurrence_occurrences" ON public.campaign_recurrence_occurrences;
CREATE POLICY "Deny all direct access to campaign_recurrence_occurrences"
  ON public.campaign_recurrence_occurrences FOR ALL USING (false);
