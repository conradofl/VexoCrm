-- Create tenant_modules table
CREATE TABLE IF NOT EXISTS public.tenant_modules (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id),
  config JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Seed default config for existing tenants
INSERT INTO public.tenant_modules (tenant_id, config)
SELECT id, '{"gd":{"payment_link_default":"https://checkout.vexo.com.br/default-gd"}}'::jsonb
FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;
