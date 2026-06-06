-- VexoCrm: leads tables for Infinie and future clients
-- client_id identifies the source (e.g. infinie). Unique per (client_id, telefone).

CREATE TABLE public.leads_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.leads (
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

CREATE INDEX idx_leads_client_id ON public.leads(client_id);
CREATE INDEX idx_leads_status ON public.leads(status);
CREATE INDEX idx_leads_data_hora ON public.leads(data_hora DESC);

-- RLS: authenticated users can read; inserts/updates only via Edge Function (service_role)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads_clients ENABLE ROW LEVEL SECURITY;

-- Read: anon + authenticated (app uses Firebase; anon key in frontend)
CREATE POLICY "Allow read leads"
  ON public.leads FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow read clients"
  ON public.leads_clients FOR SELECT
  TO anon, authenticated
  USING (true);

-- Write: only via Edge Function (service_role). No direct insert/update from client.

-- Insert default client
INSERT INTO public.leads_clients (id, name) VALUES ('infinie', 'Infinie');
