-- Tabela de registro de campos customizados por cliente
-- Permite armazenar chave normalizada, rótulo original, tipo de dado e importação de origem
CREATE TABLE IF NOT EXISTS public.lead_custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  import_id UUID REFERENCES public.lead_imports(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_lead_custom_fields_client_key UNIQUE (client_id, key)
);

CREATE INDEX IF NOT EXISTS idx_lead_custom_fields_client_id ON public.lead_custom_fields (client_id);

-- Armazena o mapeamento de colunas realizado na importação para permitir reaproveitamento
ALTER TABLE public.lead_imports ADD COLUMN IF NOT EXISTS column_mapping JSONB;
