-- Commercial Intelligence operational support tables.
-- Additive migration only.

ALTER TABLE IF EXISTS public.crm_consultants
  ADD COLUMN IF NOT EXISTS position TEXT,
  ADD COLUMN IF NOT EXISTS territory_regions TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS available_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS accepts_auto_assign BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE TABLE IF NOT EXISTS public.commercial_intelligence_settings (
  client_id TEXT PRIMARY KEY REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  qualification_threshold NUMERIC(8,2) NOT NULL DEFAULT 60,
  sla_minutes INTEGER NOT NULL DEFAULT 30,
  default_period TEXT NOT NULL DEFAULT '30d',
  distribution_strategy TEXT NOT NULL DEFAULT 'round_robin',
  ranking_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  metric_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  alert_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.metric_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  period_key TEXT NOT NULL DEFAULT 'daily',
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  dimension_type TEXT,
  dimension_value TEXT,
  metric_value NUMERIC(16,4) NOT NULL DEFAULT 0,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_metric_snapshots_unique
  ON public.metric_snapshots (client_id, metric_key, period_key, snapshot_date, COALESCE(dimension_type, ''), COALESCE(dimension_value, ''));

CREATE INDEX IF NOT EXISTS idx_metric_snapshots_client_date
  ON public.metric_snapshots (client_id, snapshot_date DESC);

ALTER TABLE public.commercial_intelligence_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny all direct access to commercial_intelligence_settings"
ON public.commercial_intelligence_settings
FOR ALL
USING (false);

CREATE POLICY "Deny all direct access to metric_snapshots"
ON public.metric_snapshots
FOR ALL
USING (false);
