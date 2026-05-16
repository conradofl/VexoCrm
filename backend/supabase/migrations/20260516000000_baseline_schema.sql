CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.normalize_br_phone(value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  digits TEXT;
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN
    RETURN NULL;
  END IF;

  digits := regexp_replace(value, '\D', '', 'g');
  IF digits = '' THEN
    RETURN NULL;
  END IF;

  digits := regexp_replace(digits, '^0+', '');

  IF length(digits) IN (10, 11) THEN
    RETURN '55' || digits;
  END IF;

  IF length(digits) = 12 AND left(digits, 2) = '55' THEN
    RETURN '55' || right(digits, 10);
  END IF;

  IF length(digits) = 13 AND left(digits, 2) = '55' THEN
    RETURN digits;
  END IF;

  RETURN digits;
END;
$$;

CREATE TABLE IF NOT EXISTS public.leads_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.leads_clients (id, name)
VALUES ('infinie', 'Infinie')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  import_id UUID,
  limit_per_run INTEGER NOT NULL DEFAULT 50,
  webhook_url TEXT,
  webhook_token TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  last_triggered_at TIMESTAMPTZ,
  created_by_uid TEXT,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_for TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  budget_amount NUMERIC(14,2),
  channel TEXT,
  audience_type TEXT,
  target_city TEXT,
  target_state TEXT,
  analytics_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  phones JSONB NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('active', 'paused', 'draft', 'scheduled', 'processing', 'sent', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_campaigns_client_id
  ON public.campaigns (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled_for
  ON public.campaigns (scheduled_for);

CREATE INDEX IF NOT EXISTS idx_campaigns_archived_at
  ON public.campaigns (archived_at);

CREATE INDEX IF NOT EXISTS idx_campaigns_analytics_meta
  ON public.campaigns USING GIN (analytics_meta);

CREATE INDEX IF NOT EXISTS idx_campaigns_dispatch_queue
  ON public.campaigns (status, scheduled_for)
  WHERE last_triggered_at IS NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.lead_client_n8n_settings (
  client_id TEXT PRIMARY KEY REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  dispatch_webhook_url TEXT,
  dispatch_webhook_token TEXT,
  inbound_bearer_token TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_uid TEXT,
  updated_by_email TEXT,
  chatbot_enabled BOOLEAN NOT NULL DEFAULT false,
  chatbot_model VARCHAR(64) NOT NULL DEFAULT 'outlier',
  sdr_whatsapp_number VARCHAR(20) DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_client_n8n_settings_active
  ON public.lead_client_n8n_settings (active);

CREATE TABLE IF NOT EXISTS public.leads_infinie (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  telefone TEXT NOT NULL,
  nome TEXT,
  tipo_cliente TEXT,
  faixa_consumo TEXT,
  cidade TEXT,
  estado TEXT,
  conta_energia TEXT,
  status TEXT,
  bot_ativo BOOLEAN DEFAULT false,
  historico TEXT,
  data_hora TIMESTAMPTZ,
  qualificacao TEXT,
  lead_temperature TEXT CHECK (lead_temperature IS NULL OR lead_temperature IN ('QUENTE', 'MORNO', 'FRIO')),
  status_conversa TEXT CHECK (status_conversa IS NULL OR status_conversa IN ('aguardando_usuario', 'em_atendimento', 'finalizado')),
  source_campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  lead_score NUMERIC(8, 2),
  potential_contract_value NUMERIC(14, 2),
  first_contact_at TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  lead_origin TEXT,
  behavior_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ultima_interacao_bot TIMESTAMPTZ,
  ultima_interacao_usuario TIMESTAMPTZ,
  mensagem TEXT,
  finalizado BOOLEAN DEFAULT false,
  spin_fase TEXT CHECK (spin_fase IS NULL OR spin_fase IN ('situacao', 'problema', 'implicacao', 'necessidade')),
  dados JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, telefone)
);

CREATE INDEX IF NOT EXISTS idx_leads_infinie_client_id
  ON public.leads_infinie (client_id);

CREATE INDEX IF NOT EXISTS idx_leads_infinie_status
  ON public.leads_infinie (status);

CREATE INDEX IF NOT EXISTS idx_leads_infinie_data_hora
  ON public.leads_infinie (data_hora DESC);

CREATE INDEX IF NOT EXISTS idx_leads_infinie_conversation_status_waiting
  ON public.leads_infinie (client_id, status_conversa, ultima_interacao_bot DESC);

CREATE INDEX IF NOT EXISTS idx_leads_infinie_source_campaign_id
  ON public.leads_infinie (source_campaign_id);

CREATE INDEX IF NOT EXISTS idx_leads_infinie_first_contact_at
  ON public.leads_infinie (first_contact_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_infinie_qualified_at
  ON public.leads_infinie (qualified_at DESC);

CREATE TABLE IF NOT EXISTS public.leads_teste (
  LIKE public.leads_infinie INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_teste_pkey'
      AND conrelid = 'public.leads_teste'::regclass
  ) THEN
    ALTER TABLE public.leads_teste ADD PRIMARY KEY (id);
  END IF;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS leads_teste_client_id_telefone_key
  ON public.leads_teste (client_id, telefone);

CREATE TABLE IF NOT EXISTS public.leads_outlier (
  LIKE public.leads_infinie INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_outlier_client_id_telefone_key
  ON public.leads_outlier (client_id, telefone);

CREATE TABLE IF NOT EXISTS public.lead_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'spreadsheet',
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  skipped_rows INTEGER NOT NULL DEFAULT 0,
  uploaded_by_uid TEXT,
  uploaded_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_imports_client_created_at
  ON public.lead_imports (client_id, created_at DESC);

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_import_id_fkey;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_import_id_fkey
  FOREIGN KEY (import_id)
  REFERENCES public.lead_imports(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.lead_import_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES public.lead_imports(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  telefone TEXT,
  lead_id UUID,
  imported BOOLEAN NOT NULL DEFAULT false,
  skip_reason TEXT,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_conversa TEXT,
  ultima_interacao_bot TIMESTAMPTZ,
  ultima_interacao_usuario TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lead_import_items_status_conversa_check'
      AND conrelid = 'public.lead_import_items'::regclass
  ) THEN
    ALTER TABLE public.lead_import_items
      ADD CONSTRAINT lead_import_items_status_conversa_check
      CHECK (
        status_conversa IS NULL
        OR status_conversa IN ('aguardando_usuario', 'em_atendimento', 'finalizado')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lead_import_items_import_id
  ON public.lead_import_items (import_id);

CREATE INDEX IF NOT EXISTS idx_lead_import_items_client_id
  ON public.lead_import_items (client_id);

CREATE INDEX IF NOT EXISTS idx_lead_import_items_phone
  ON public.lead_import_items (telefone);

CREATE INDEX IF NOT EXISTS idx_lead_import_items_conversation_status_waiting
  ON public.lead_import_items (client_id, status_conversa, ultima_interacao_bot DESC);

CREATE TABLE IF NOT EXISTS public.access_profiles (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  role TEXT NOT NULL,
  scope_mode TEXT NOT NULL DEFAULT 'assigned_clients',
  approval_level TEXT NOT NULL DEFAULT 'none',
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  internal_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_views JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.access_profiles (
  key,
  label,
  description,
  role,
  scope_mode,
  approval_level,
  permissions,
  internal_pages,
  allowed_views,
  is_system,
  is_locked
)
VALUES
  (
    'internal_admin',
    'Admin interno',
    'Acesso total ao CRM e administracao do ambiente.',
    'internal',
    'all_clients',
    'director',
    '["dashboard.view","leads.view","leads.export","imports.manage","whatsapp.view","whatsapp.reply","campaigns.manage","agente.view","users.view","users.manage"]'::jsonb,
    '["dashboard","leads","planilhas","whatsapp","agente","usuarios","campanhas"]'::jsonb,
    '[]'::jsonb,
    true,
    true
  ),
  (
    'internal_manager',
    'Gestor interno',
    'Gestao operacional com acesso ampliado aos modulos internos.',
    'internal',
    'assigned_clients',
    'manager',
    '["dashboard.view","leads.view","leads.export","imports.manage","whatsapp.view","whatsapp.reply","campaigns.manage","agente.view","users.view"]'::jsonb,
    '["dashboard","leads","planilhas","whatsapp","agente","usuarios","campanhas"]'::jsonb,
    '[]'::jsonb,
    true,
    false
  ),
  (
    'internal_operator',
    'Operacao interna',
    'Operacao padrao do CRM para times internos.',
    'internal',
    'assigned_clients',
    'operator',
    '["dashboard.view","leads.view","imports.manage","whatsapp.view","whatsapp.reply"]'::jsonb,
    '["dashboard","leads","planilhas","whatsapp"]'::jsonb,
    '[]'::jsonb,
    true,
    false
  ),
  (
    'client_manager',
    'Gestor do cliente',
    'Perfil de cliente com acesso expandido ao portal.',
    'client',
    'assigned_clients',
    'manager',
    '["dashboard.view","leads.view","leads.export","imports.manage","whatsapp.view","whatsapp.reply"]'::jsonb,
    '[]'::jsonb,
    '["dashboard","leads","planilhas","whatsapp"]'::jsonb,
    true,
    false
  ),
  (
    'client_operator',
    'Operador do cliente',
    'Perfil de cliente operacional para uso diario.',
    'client',
    'assigned_clients',
    'operator',
    '["dashboard.view","leads.view","whatsapp.view","whatsapp.reply"]'::jsonb,
    '[]'::jsonb,
    '["dashboard","leads","whatsapp"]'::jsonb,
    true,
    false
  ),
  (
    'client_viewer',
    'Leitura do cliente',
    'Perfil de cliente com acesso de leitura.',
    'client',
    'assigned_clients',
    'none',
    '["dashboard.view","leads.view"]'::jsonb,
    '[]'::jsonb,
    '["dashboard","leads"]'::jsonb,
    true,
    false
  ),
  (
    'pending',
    'Aguardando aprovacao',
    'Conta ainda sem liberacao operacional.',
    'pending',
    'no_client_access',
    'none',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    true,
    false
  )
ON CONFLICT (key) DO NOTHING;

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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  position TEXT,
  territory_regions TEXT[] NOT NULL DEFAULT '{}',
  available_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  accepts_auto_assign BOOLEAN NOT NULL DEFAULT true,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_crm_consultants_client_active
  ON public.crm_consultants (client_id, active, available);

CREATE TABLE IF NOT EXISTS public.lead_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  lead_id UUID,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  phone TEXT,
  sender_type TEXT NOT NULL DEFAULT 'agent',
  direction TEXT NOT NULL DEFAULT 'outbound',
  engagement_signal TEXT,
  message_text TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_lead_messages_client_created_at
  ON public.lead_messages (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_messages_lead_id
  ON public.lead_messages (lead_id);

CREATE TABLE IF NOT EXISTS public.lead_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_lead_assignments_client_assigned_at
  ON public.lead_assignments (client_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_assignments_consultant_status
  ON public.lead_assignments (consultant_id, assignment_status);

CREATE TABLE IF NOT EXISTS public.lead_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS public.vexo_sales_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  owner_company TEXT NOT NULL DEFAULT 'vexo',
  internal_module BOOLEAN NOT NULL DEFAULT true,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  source TEXT,
  segment TEXT,
  estimated_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'Novo lead' CHECK (
    stage IN (
      'Novo lead',
      'Primeiro contato',
      'Qualificação',
      'Diagnóstico',
      'Proposta enviada',
      'Negociação',
      'Fechado ganho',
      'Fechado perdido'
    )
  ),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'pausado', 'ganho', 'perdido')),
  priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa', 'media', 'alta')),
  assigned_to TEXT,
  expected_close_date DATE,
  notes TEXT,
  created_by TEXT,
  created_by_uid TEXT
);

CREATE TABLE IF NOT EXISTS public.vexo_sales_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES public.vexo_sales_opportunities(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  interaction_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL CHECK (type IN ('ligacao', 'whatsapp', 'reuniao', 'email', 'observacao')),
  description TEXT NOT NULL,
  responsible_user TEXT,
  created_by TEXT,
  created_by_uid TEXT
);

CREATE INDEX IF NOT EXISTS idx_vexo_sales_opportunities_stage
  ON public.vexo_sales_opportunities(stage);

CREATE INDEX IF NOT EXISTS idx_vexo_sales_opportunities_status
  ON public.vexo_sales_opportunities(status);

CREATE INDEX IF NOT EXISTS idx_vexo_sales_opportunities_priority
  ON public.vexo_sales_opportunities(priority);

CREATE INDEX IF NOT EXISTS idx_vexo_sales_opportunities_assigned_to
  ON public.vexo_sales_opportunities(assigned_to);

CREATE INDEX IF NOT EXISTS idx_vexo_sales_opportunities_updated_at
  ON public.vexo_sales_opportunities(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_vexo_sales_interactions_opportunity_id
  ON public.vexo_sales_interactions(opportunity_id, interaction_at DESC);

CREATE TABLE IF NOT EXISTS public.chatbot_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('padrao', 'campanha')),
  content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_email TEXT,
  UNIQUE (client_id, type)
);

CREATE INDEX IF NOT EXISTS chatbot_prompts_client_id_idx
  ON public.chatbot_prompts (client_id);

ALTER TABLE public.lead_client_n8n_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_consultants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_intelligence_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_dispatch_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vexo_sales_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vexo_sales_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all direct access to lead_client_n8n_settings" ON public.lead_client_n8n_settings;
CREATE POLICY "Deny all direct access to lead_client_n8n_settings" ON public.lead_client_n8n_settings FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all direct access to lead_imports" ON public.lead_imports;
CREATE POLICY "Deny all direct access to lead_imports" ON public.lead_imports FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all direct access to lead_import_items" ON public.lead_import_items;
CREATE POLICY "Deny all direct access to lead_import_items" ON public.lead_import_items FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all direct access to access_profiles" ON public.access_profiles;
CREATE POLICY "Deny all direct access to access_profiles" ON public.access_profiles FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all direct access to crm_consultants" ON public.crm_consultants;
CREATE POLICY "Deny all direct access to crm_consultants" ON public.crm_consultants FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all direct access to lead_messages" ON public.lead_messages;
CREATE POLICY "Deny all direct access to lead_messages" ON public.lead_messages FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all direct access to lead_assignments" ON public.lead_assignments;
CREATE POLICY "Deny all direct access to lead_assignments" ON public.lead_assignments FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all direct access to lead_conversions" ON public.lead_conversions;
CREATE POLICY "Deny all direct access to lead_conversions" ON public.lead_conversions FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all direct access to lead_distribution_rules" ON public.lead_distribution_rules;
CREATE POLICY "Deny all direct access to lead_distribution_rules" ON public.lead_distribution_rules FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all direct access to analytics_insights" ON public.analytics_insights;
CREATE POLICY "Deny all direct access to analytics_insights" ON public.analytics_insights FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all direct access to commercial_intelligence_settings" ON public.commercial_intelligence_settings;
CREATE POLICY "Deny all direct access to commercial_intelligence_settings" ON public.commercial_intelligence_settings FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all direct access to metric_snapshots" ON public.metric_snapshots;
CREATE POLICY "Deny all direct access to metric_snapshots" ON public.metric_snapshots FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny all direct access to campaign_dispatch_logs" ON public.campaign_dispatch_logs;
CREATE POLICY "Deny all direct access to campaign_dispatch_logs" ON public.campaign_dispatch_logs FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny direct access to Vexo sales opportunities" ON public.vexo_sales_opportunities;
CREATE POLICY "Deny direct access to Vexo sales opportunities" ON public.vexo_sales_opportunities FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Deny direct access to Vexo sales interactions" ON public.vexo_sales_interactions;
CREATE POLICY "Deny direct access to Vexo sales interactions" ON public.vexo_sales_interactions FOR ALL USING (false) WITH CHECK (false);
