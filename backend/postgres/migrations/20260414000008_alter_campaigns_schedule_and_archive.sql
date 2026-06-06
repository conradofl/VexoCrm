ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled_for
  ON public.campaigns (scheduled_for);

CREATE INDEX IF NOT EXISTS idx_campaigns_archived_at
  ON public.campaigns (archived_at);
