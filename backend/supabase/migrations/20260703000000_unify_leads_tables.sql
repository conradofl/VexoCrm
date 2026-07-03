-- Migration para recriar a tabela unificada `leads` e migrar dados das tabelas de tenant.

CREATE TABLE IF NOT EXISTS public.leads (
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
  source_campaign_name TEXT,
  lead_source TEXT CHECK (lead_source IS NULL OR lead_source IN ('campanha', 'organico', 'trafego_pago', 'whatsapp_ads', 'indicacao', 'outro')),
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
  data_nascimento DATE,
  ultima_visita DATE,
  perfil_musical TEXT,
  interesse TEXT,
  objetivo TEXT,
  prazo TEXT,
  melhor_horario TEXT,
  tipo_instalacao TEXT,
  conta_luz_faixa TEXT,
  credito TEXT,
  parcela TEXT,
  lance_entrada_fgts TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, telefone)
);

CREATE INDEX IF NOT EXISTS idx_leads_client_id ON public.leads (client_id);
CREATE INDEX IF NOT EXISTS idx_leads_telefone ON public.leads (telefone);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads (created_at DESC);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all direct access to leads" ON public.leads;
CREATE POLICY "Deny all direct access to leads" ON public.leads FOR ALL USING (false);

DO $$
DECLARE
    r RECORD;
    cols text;
BEGIN
    FOR r IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'leads_%' AND table_name != 'leads_clients'
    LOOP
        -- Obter interseção de colunas
        SELECT string_agg(column_name, ', ') INTO cols
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'leads'
          AND column_name IN (
              SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = r.table_name
          );

        IF cols IS NOT NULL THEN
            EXECUTE 'INSERT INTO public.leads (' || cols || ') SELECT ' || cols || ' FROM public.' || quote_ident(r.table_name) || ' ON CONFLICT (client_id, telefone) DO NOTHING';
        END IF;
    END LOOP;
END $$;

