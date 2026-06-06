-- Enables operational campaign scheduling, status transitions and dispatch logs.
-- The backend uses these fields to avoid duplicated campaign sends.

DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.campaigns'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
  END LOOP;
END $$;

ALTER TABLE public.campaigns
  ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('active', 'paused', 'draft', 'scheduled', 'processing', 'sent', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_campaigns_dispatch_queue
  ON public.campaigns (status, scheduled_for)
  WHERE last_triggered_at IS NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.campaign_dispatch_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  trigger_source TEXT NOT NULL DEFAULT 'scheduler',
  message TEXT,
  total_leads INTEGER,
  webhook_status INTEGER,
  payload JSONB,
  n8n_response TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_dispatch_logs_campaign_created
  ON public.campaign_dispatch_logs (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_dispatch_logs_client_created
  ON public.campaign_dispatch_logs (client_id, created_at DESC);

ALTER TABLE public.campaign_dispatch_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all direct access to campaign_dispatch_logs"
ON public.campaign_dispatch_logs;

CREATE POLICY "Deny all direct access to campaign_dispatch_logs"
ON public.campaign_dispatch_logs
FOR ALL
USING (false);
