-- Revenue Ops foundation for CRM analytics, distribution and conversion intelligence.
-- Everything here is additive to preserve current CRM behavior.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'campaigns'
  ) THEN
    ALTER TABLE public.campaigns
      ADD COLUMN IF NOT EXISTS budget_amount NUMERIC(14,2),
      ADD COLUMN IF NOT EXISTS channel TEXT,
      ADD COLUMN IF NOT EXISTS audience_type TEXT,
      ADD COLUMN IF NOT EXISTS target_city TEXT,
      ADD COLUMN IF NOT EXISTS target_state TEXT,
      ADD COLUMN IF NOT EXISTS analytics_meta JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS source_campaign_id UUID,
  ADD COLUMN IF NOT EXISTS lead_score NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS potential_contract_value NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lead_temperature TEXT,
  ADD COLUMN IF NOT EXISTS lead_origin TEXT,
  ADD COLUMN IF NOT EXISTS behavior_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'campaigns'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_source_campaign_id_fkey
      FOREIGN KEY (source_campaign_id)
      REFERENCES public.campaigns(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_source_campaign_id
  ON public.leads (source_campaign_id);

CREATE INDEX IF NOT EXISTS idx_leads_first_contact_at
  ON public.leads (first_contact_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_qualified_at
  ON public.leads (qualified_at DESC);

CREATE TABLE IF NOT EXISTS public.crm_consultants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  city TEXT,
  state TEXT,
  territory_cities TEXT[] NOT NULL DEFAULT '{}',
  territory_states TEXT[] NOT NULL DEFAULT '{}',
  lead_types TEXT[] NOT NULL DEFAULT '{}',
  contract_value_min NUMERIC(14,2),
  contract_value_max NUMERIC(14,2),
  daily_capacity INTEGER NOT NULL DEFAULT 20,
  open_lead_limit INTEGER NOT NULL DEFAULT 30,
  assignment_weight NUMERIC(8,2) NOT NULL DEFAULT 1,
  priority_rank INTEGER NOT NULL DEFAULT 100,
  available BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  performance_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_consultants_client_active
  ON public.crm_consultants (client_id, active, available);

CREATE TABLE IF NOT EXISTS public.lead_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  campaign_id UUID,
  phone TEXT,
  sender_type TEXT NOT NULL DEFAULT 'agent',
  direction TEXT NOT NULL DEFAULT 'outbound',
  engagement_signal TEXT,
  message_text TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'campaigns'
  ) THEN
    ALTER TABLE public.lead_messages
      ADD CONSTRAINT lead_messages_campaign_id_fkey
      FOREIGN KEY (campaign_id)
      REFERENCES public.campaigns(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_lead_messages_client_created_at
  ON public.lead_messages (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_messages_lead_id
  ON public.lead_messages (lead_id);

CREATE TABLE IF NOT EXISTS public.lead_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  campaign_id UUID,
  consultant_id UUID REFERENCES public.crm_consultants(id) ON DELETE SET NULL,
  assignment_mode TEXT NOT NULL DEFAULT 'round_robin',
  assignment_status TEXT NOT NULL DEFAULT 'assigned',
  assignment_score NUMERIC(8,2),
  assignment_reason JSONB NOT NULL DEFAULT '{}'::jsonb,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  reassigned_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  response_due_at TIMESTAMPTZ,
  reassign_count INTEGER NOT NULL DEFAULT 0
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'campaigns'
  ) THEN
    ALTER TABLE public.lead_assignments
      ADD CONSTRAINT lead_assignments_campaign_id_fkey
      FOREIGN KEY (campaign_id)
      REFERENCES public.campaigns(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_lead_assignments_client_assigned_at
  ON public.lead_assignments (client_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_assignments_consultant_status
  ON public.lead_assignments (consultant_id, assignment_status);

CREATE TABLE IF NOT EXISTS public.lead_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  campaign_id UUID,
  consultant_id UUID REFERENCES public.crm_consultants(id) ON DELETE SET NULL,
  conversion_status TEXT NOT NULL DEFAULT 'open',
  contract_value NUMERIC(14,2),
  revenue_amount NUMERIC(14,2),
  loss_reason TEXT,
  first_contact_at TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'campaigns'
  ) THEN
    ALTER TABLE public.lead_conversions
      ADD CONSTRAINT lead_conversions_campaign_id_fkey
      FOREIGN KEY (campaign_id)
      REFERENCES public.campaigns(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_lead_conversions_client_status
  ON public.lead_conversions (client_id, conversion_status, closed_at DESC);

CREATE TABLE IF NOT EXISTS public.lead_distribution_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  distribution_mode TEXT NOT NULL DEFAULT 'round_robin',
  prioritize_region BOOLEAN NOT NULL DEFAULT true,
  prioritize_contract_value BOOLEAN NOT NULL DEFAULT true,
  prioritize_lead_type BOOLEAN NOT NULL DEFAULT true,
  max_open_leads_per_consultant INTEGER NOT NULL DEFAULT 30,
  reassign_after_minutes INTEGER NOT NULL DEFAULT 30,
  fairness_floor NUMERIC(8,2) NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_distribution_rules_client_active
  ON public.lead_distribution_rules (client_id, active);

CREATE TABLE IF NOT EXISTS public.analytics_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL,
  insight_scope TEXT NOT NULL DEFAULT 'dashboard',
  related_id TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  status TEXT NOT NULL DEFAULT 'open',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_analytics_insights_client_generated_at
  ON public.analytics_insights (client_id, generated_at DESC);

ALTER TABLE public.crm_consultants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny all direct access to crm_consultants"
ON public.crm_consultants
FOR ALL
USING (false);

CREATE POLICY "Deny all direct access to lead_messages"
ON public.lead_messages
FOR ALL
USING (false);

CREATE POLICY "Deny all direct access to lead_assignments"
ON public.lead_assignments
FOR ALL
USING (false);

CREATE POLICY "Deny all direct access to lead_conversions"
ON public.lead_conversions
FOR ALL
USING (false);

CREATE POLICY "Deny all direct access to lead_distribution_rules"
ON public.lead_distribution_rules
FOR ALL
USING (false);

CREATE POLICY "Deny all direct access to analytics_insights"
ON public.analytics_insights
FOR ALL
USING (false);
