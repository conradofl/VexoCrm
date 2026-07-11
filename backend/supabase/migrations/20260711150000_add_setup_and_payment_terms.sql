-- 1. Setup Vexo opcional na proposta (campos opcionais; propostas antigas continuam válidas)
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS cobrar_setup BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS valor_setup_vexo NUMERIC;

-- 2. Condições de pagamento ofertadas/escolhida na proposta (JSONB opcional)
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS condicoes_pagamento JSONB;

-- 3. Tabela de condições de pagamento reutilizáveis (tenant-scoped, mesmo padrão de gd_packages)
CREATE TABLE IF NOT EXISTS public.gd_payment_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'custom',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
