-- Adiciona os 4 documentos-chave do cliente GD (Degrau 1 do Portal do Cliente).
-- Todos são opcionais e precisam começar com https:// quando informados.

ALTER TABLE public.gd_clientes
  ADD COLUMN IF NOT EXISTS contrato_url      text,
  ADD COLUMN IF NOT EXISTS briefing_url      text,
  ADD COLUMN IF NOT EXISTS ficha_vexo_url    text,
  ADD COLUMN IF NOT EXISTS planejamento_url  text;

ALTER TABLE public.gd_clientes DROP CONSTRAINT IF EXISTS gd_clientes_contrato_url;
ALTER TABLE public.gd_clientes ADD CONSTRAINT gd_clientes_contrato_url
  CHECK (contrato_url IS NULL OR contrato_url ~ '^https://');

ALTER TABLE public.gd_clientes DROP CONSTRAINT IF EXISTS gd_clientes_briefing_url;
ALTER TABLE public.gd_clientes ADD CONSTRAINT gd_clientes_briefing_url
  CHECK (briefing_url IS NULL OR briefing_url ~ '^https://');

ALTER TABLE public.gd_clientes DROP CONSTRAINT IF EXISTS gd_clientes_ficha_vexo_url;
ALTER TABLE public.gd_clientes ADD CONSTRAINT gd_clientes_ficha_vexo_url
  CHECK (ficha_vexo_url IS NULL OR ficha_vexo_url ~ '^https://');

ALTER TABLE public.gd_clientes DROP CONSTRAINT IF EXISTS gd_clientes_planejamento_url;
ALTER TABLE public.gd_clientes ADD CONSTRAINT gd_clientes_planejamento_url
  CHECK (planejamento_url IS NULL OR planejamento_url ~ '^https://');
