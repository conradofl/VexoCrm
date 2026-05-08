-- Leads do bot de chat outlier: colunas do payload completo + JSONB para `dados` aninhado.
-- Insert pelo service role / backend; RLS nega acesso direto do cliente.


CREATE TABLE IF NOT EXISTS public.leads_outlier (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  mensagem TEXT NOT NULL,
  finalizado BOOLEAN NOT NULL,
  status_conversa TEXT NOT NULL,
  status TEXT,
  spin_fase TEXT,
  dados JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leads_outlier_status_conversa_check
    CHECK (status_conversa IN ('aguardando_usuario', 'em_atendimento', 'finalizado')),
  CONSTRAINT leads_outlier_status_check
    CHECK (status IS NULL OR status IN ('QUENTE', 'MORNO', 'FRIO')),
  CONSTRAINT leads_outlier_spin_fase_check
    CHECK (
      spin_fase IS NULL
      OR spin_fase IN ('situacao', 'problema', 'implicacao', 'necessidade')
    ),
  CONSTRAINT leads_outlier_dados_object_check
    CHECK (jsonb_typeof(dados) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_leads_outlier_client_created_at
  ON public.leads_outlier (client_id, created_at DESC);

ALTER TABLE public.leads_outlier ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all direct access to leads_outlier"
ON public.leads_outlier;

CREATE POLICY "Deny all direct access to leads_outlier"
ON public.leads_outlier
FOR ALL
USING (false);
