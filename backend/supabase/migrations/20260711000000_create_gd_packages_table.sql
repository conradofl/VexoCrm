-- 1. Create gd_packages table
CREATE TABLE IF NOT EXISTS public.gd_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  nome TEXT NOT NULL,
  periodo TEXT NOT NULL,
  produtos_incluidos JSONB NOT NULL,
  valor NUMERIC NOT NULL DEFAULT 0,
  destaque BOOLEAN NOT NULL DEFAULT false,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add columns to gd_presentations
ALTER TABLE public.gd_presentations ADD COLUMN IF NOT EXISTS pacotes_ofertados JSONB;

-- 3. Add columns to gd_proposals
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES public.gd_packages(id);
