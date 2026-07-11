-- 1. Tabela de Tenants (se não existir)
CREATE TABLE IF NOT EXISTS public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Tabela gd_segments
CREATE TABLE IF NOT EXISTS public.gd_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  nome TEXT NOT NULL,
  faturamento_min NUMERIC NOT NULL DEFAULT 50000,
  ativo BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (tenant_id, nome)
);

-- 3. Tabela gd_products
CREATE TABLE IF NOT EXISTS public.gd_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'gd',
  valor_padrao NUMERIC NOT NULL DEFAULT 0,
  recorrencia TEXT NOT NULL DEFAULT 'mensal',
  ativo BOOLEAN NOT NULL DEFAULT true
);

-- 4. Tabela gd_presentations
CREATE TABLE IF NOT EXISTS public.gd_presentations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  prospect_name TEXT,
  prospect_logo TEXT,
  segment_id UUID REFERENCES public.gd_segments(id),
  venda_casada BOOLEAN NOT NULL DEFAULT false,
  produtos_selecionados JSONB,
  roi JSONB,
  status TEXT NOT NULL DEFAULT 'rascunho',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Tabela gd_proposals
CREATE TABLE IF NOT EXISTS public.gd_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  presentation_id UUID REFERENCES public.gd_presentations(id),
  prospect_name TEXT,
  itens JSONB NOT NULL,
  valor_total NUMERIC NOT NULL DEFAULT 0,
  condicoes TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho',
  payment_link TEXT,
  sent_at TIMESTAMPTZ,
  assinatura TEXT,
  signer_name TEXT,
  signed_at TIMESTAMPTZ,
  signer_ip TEXT,
  termo_aceite TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
