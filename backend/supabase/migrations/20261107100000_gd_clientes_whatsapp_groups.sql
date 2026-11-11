-- Grupos de WhatsApp e status de Onboarding do cliente da Geração Digital (GoClaw Braços).
-- Permite armazenar o JID e link de convite do grupo interno da equipe GD e do grupo com o cliente,
-- além do timestamp de conclusão do onboarding.

ALTER TABLE public.gd_clientes
  ADD COLUMN IF NOT EXISTS grupo_interno_jid       text,
  ADD COLUMN IF NOT EXISTS grupo_interno_url       text,
  ADD COLUMN IF NOT EXISTS grupo_cliente_jid       text,
  ADD COLUMN IF NOT EXISTS grupo_cliente_url       text,
  ADD COLUMN IF NOT EXISTS onboarding_concluido_em timestamptz;

ALTER TABLE public.gd_clientes DROP CONSTRAINT IF EXISTS gd_clientes_grupo_interno_url;
ALTER TABLE public.gd_clientes ADD CONSTRAINT gd_clientes_grupo_interno_url
  CHECK (grupo_interno_url IS NULL OR grupo_interno_url ~ '^https://');

ALTER TABLE public.gd_clientes DROP CONSTRAINT IF EXISTS gd_clientes_grupo_cliente_url;
ALTER TABLE public.gd_clientes ADD CONSTRAINT gd_clientes_grupo_cliente_url
  CHECK (grupo_cliente_url IS NULL OR grupo_cliente_url ~ '^https://');

