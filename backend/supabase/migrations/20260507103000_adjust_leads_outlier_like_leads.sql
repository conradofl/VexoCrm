-- Alinha public.leads_outlier ao conjunto de colunas de public.leads (exceto tipo_cliente, faixa_consumo,
-- cidade, estado — ficam no JSON `dados` do chatbot quando precisar).
-- Migra temperatura legada na coluna `status` + constraint leads_outlier_status_check
-- para lead_temperature; recria `status` como TEXT genérico nullable (mesmo papel que leads.status).


ALTER TABLE public.leads_outlier ADD COLUMN IF NOT EXISTS lead_temperature TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'leads_outlier'
      AND column_name = 'status'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'leads_outlier'
      AND c.conname = 'leads_outlier_status_check'
  ) THEN
    UPDATE public.leads_outlier lo
    SET lead_temperature = lo.status
    WHERE lo.lead_temperature IS NULL
      AND lo.status IS NOT NULL
      AND lo.status IN ('QUENTE', 'MORNO', 'FRIO');

    ALTER TABLE public.leads_outlier DROP CONSTRAINT leads_outlier_status_check;
    ALTER TABLE public.leads_outlier DROP COLUMN status;
    ALTER TABLE public.leads_outlier ADD COLUMN status TEXT;
  END IF;
END $$;

ALTER TABLE public.leads_outlier ADD COLUMN IF NOT EXISTS status TEXT;

ALTER TABLE public.leads_outlier DROP CONSTRAINT IF EXISTS leads_outlier_lead_temperature_check;

ALTER TABLE public.leads_outlier
  ADD CONSTRAINT leads_outlier_lead_temperature_check
  CHECK (lead_temperature IS NULL OR lead_temperature IN ('QUENTE', 'MORNO', 'FRIO'));

ALTER TABLE public.leads_outlier
  ADD COLUMN IF NOT EXISTS telefone TEXT,
  ADD COLUMN IF NOT EXISTS nome TEXT,
  ADD COLUMN IF NOT EXISTS conta_energia TEXT,
  ADD COLUMN IF NOT EXISTS bot_ativo BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS historico TEXT,
  ADD COLUMN IF NOT EXISTS data_hora TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qualificacao TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lead_score NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS potential_contract_value NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lead_origin TEXT,
  ADD COLUMN IF NOT EXISTS behavior_meta JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ultima_interacao_bot TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultima_interacao_usuario TIMESTAMPTZ;

ALTER TABLE public.leads_outlier
  ADD COLUMN IF NOT EXISTS status_conversa TEXT,
  ADD COLUMN IF NOT EXISTS source_campaign_id UUID;

UPDATE public.leads_outlier
SET behavior_meta = '{}'::jsonb
WHERE behavior_meta IS NULL;

ALTER TABLE public.leads_outlier
  ALTER COLUMN behavior_meta SET DEFAULT '{}'::jsonb,
  ALTER COLUMN behavior_meta SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'campaigns'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_outlier_source_campaign_id_fkey'
  ) THEN
    ALTER TABLE public.leads_outlier
      ADD CONSTRAINT leads_outlier_source_campaign_id_fkey
      FOREIGN KEY (source_campaign_id)
      REFERENCES public.campaigns(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

UPDATE public.leads_outlier
SET telefone = '5500000000000'
WHERE telefone IS NULL OR trim(telefone) = '';

ALTER TABLE public.leads_outlier
  ALTER COLUMN telefone SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_outlier_client_id
  ON public.leads_outlier (client_id);

CREATE INDEX IF NOT EXISTS idx_leads_outlier_status
  ON public.leads_outlier (status);

CREATE INDEX IF NOT EXISTS idx_leads_outlier_data_hora
  ON public.leads_outlier (data_hora DESC);

CREATE INDEX IF NOT EXISTS idx_leads_outlier_conversation_status_waiting
  ON public.leads_outlier (client_id, status_conversa, ultima_interacao_bot DESC);

CREATE INDEX IF NOT EXISTS idx_leads_outlier_source_campaign_id
  ON public.leads_outlier (source_campaign_id);

CREATE INDEX IF NOT EXISTS idx_leads_outlier_first_contact_at
  ON public.leads_outlier (first_contact_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_outlier_qualified_at
  ON public.leads_outlier (qualified_at DESC);
