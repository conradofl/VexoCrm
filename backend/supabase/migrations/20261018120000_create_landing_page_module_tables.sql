-- backend/supabase/migrations/20261018120000_create_landing_page_module_tables.sql
-- Módulo 06: Página de Captação & Telemetria Comportamental (LGPD-compliant)
-- ATENÇÃO: NÃO APLICAR EM PRODUÇÃO SEM O DONO ACORDADO OLHANDO (Trava de segurança d657449)

-- 1. TABELA DE PÁGINAS DE CAPTAÇÃO POR CLIENTE (MODELOS FECHADOS COM CONTEÚDO CONFIGURÁVEL)
CREATE TABLE IF NOT EXISTS public.landing_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  subdomain TEXT,
  custom_domain TEXT,
  template_id TEXT NOT NULL DEFAULT 'captacao' CHECK (template_id IN ('captacao', 'apresentacao', 'oferta_unica')),
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  visits_count INT NOT NULL DEFAULT 0,
  leads_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_landing_pages_tenant_slug ON public.landing_pages(client_id, slug);
CREATE INDEX IF NOT EXISTS idx_landing_pages_subdomain ON public.landing_pages(subdomain) WHERE subdomain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_landing_pages_custom_domain ON public.landing_pages(custom_domain) WHERE custom_domain IS NOT NULL;

-- 2. TABELA DE SESSÕES DE VISITAS (LGPD: ANÔNIMO ANTES DO FORMULÁRIO, AMARRADO AO LEAD APÓS SUBMIT)
CREATE TABLE IF NOT EXISTS public.landing_page_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  landing_page_id UUID NOT NULL REFERENCES public.landing_pages(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL UNIQUE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE, -- LGPD: apagar o lead apaga a sessão em cascata
  consent_given BOOLEAN NOT NULL DEFAULT false, -- LGPD: rastreamento comportamental só após aceite ativo
  consent_at TIMESTAMPTZ,
  ip_hash TEXT, -- Pseudonimizado (hash SHA-256 do IP com salt para LGPD)
  user_agent TEXT,
  device_type TEXT DEFAULT 'mobile', -- 'mobile', 'desktop', 'tablet'
  referrer TEXT,
  traffic_source TEXT DEFAULT 'direto', -- 'instagram', 'whatsapp', 'google', 'direto'
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  converted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_landing_page_sessions_tenant_page ON public.landing_page_sessions(client_id, landing_page_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_landing_page_sessions_lead ON public.landing_page_sessions(lead_id) WHERE lead_id IS NOT NULL;

-- 3. TABELA DE TELEMETRIA E EVENTOS COMPORTAMENTAIS DA JORNADA DO VISITANTE
CREATE TABLE IF NOT EXISTS public.landing_page_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.landing_page_sessions(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'scroll_depth', 'section_view', 'element_click', 'form_open', 'field_abandoned', 'form_submit'
  element_id TEXT,
  section_name TEXT,
  time_spent_seconds INT DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_landing_page_events_session ON public.landing_page_events(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_landing_page_events_tenant_type ON public.landing_page_events(client_id, event_type, created_at DESC);
