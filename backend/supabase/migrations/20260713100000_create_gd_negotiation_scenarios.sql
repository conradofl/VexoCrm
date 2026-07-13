-- Cenários de concessão pré-configurados da Mesa de Negociação (tenant-scoped).
-- config guarda as alavancas (NegotiationLayers parcial). Idempotente, não-destrutiva.
CREATE TABLE IF NOT EXISTS public.gd_negotiation_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  nome TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
