-- Renomeia a tabela genérica `leads` para `leads_infinie` (era de uso exclusivo da Infinie).
-- Cria `leads_teste` com o mesmo schema para a empresa "teste".
-- Padrão daqui pra frente: cada empresa tem sua própria tabela `leads_{client_id}`.

-- 1. Renomear leads → leads_infinie
ALTER TABLE IF EXISTS public.leads RENAME TO leads_infinie;

-- Renomear constraints e indexes para o novo nome (segurança caso existam com nome derivado)
ALTER INDEX IF EXISTS idx_leads_client_id RENAME TO idx_leads_infinie_client_id;
ALTER INDEX IF EXISTS idx_leads_status RENAME TO idx_leads_infinie_status;
ALTER INDEX IF EXISTS idx_leads_data_hora RENAME TO idx_leads_infinie_data_hora;
ALTER INDEX IF EXISTS idx_leads_conversation_status_waiting RENAME TO idx_leads_infinie_conversation_status_waiting;

-- Renomear constraint de status_conversa se existir
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_status_conversa_check'
      AND conrelid = 'public.leads_infinie'::regclass
  ) THEN
    ALTER TABLE public.leads_infinie
      RENAME CONSTRAINT leads_status_conversa_check TO leads_infinie_status_conversa_check;
  END IF;
END $$;

-- 2. Criar leads_teste com mesmo schema que leads_infinie
CREATE TABLE IF NOT EXISTS public.leads_teste (
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

CREATE INDEX IF NOT EXISTS idx_leads_teste_client_id ON public.leads_teste (client_id);
CREATE INDEX IF NOT EXISTS idx_leads_teste_status ON public.leads_teste (status);
CREATE INDEX IF NOT EXISTS idx_leads_teste_data_hora ON public.leads_teste (data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_leads_teste_conversation_status_waiting
  ON public.leads_teste (client_id, status_conversa, ultima_interacao_bot DESC);

ALTER TABLE public.leads_teste ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny all direct access to leads_teste"
  ON public.leads_teste FOR ALL USING (false);
