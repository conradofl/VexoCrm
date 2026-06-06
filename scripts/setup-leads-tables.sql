-- VexoCrm: Create leads tables (run in Supabase SQL Editor)
-- Project: https://supabase.com/dashboard/project/yfhdzkjuhxsbxklfgdut/sql

-- Tables
CREATE TABLE IF NOT EXISTS public.leads_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

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
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, telefone)
);

CREATE INDEX IF NOT EXISTS idx_leads_client_id ON public.leads(client_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_data_hora ON public.leads(data_hora DESC);

-- RLS
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read leads" ON public.leads;
CREATE POLICY "Allow read leads"
  ON public.leads FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow read clients" ON public.leads_clients;
CREATE POLICY "Allow read clients"
  ON public.leads_clients FOR SELECT
  TO anon, authenticated
  USING (true);

-- Default client (service_role bypasses RLS for backend/import)
INSERT INTO public.leads_clients (id, name) VALUES ('infinie', 'Infinie')
ON CONFLICT (id) DO NOTHING;
