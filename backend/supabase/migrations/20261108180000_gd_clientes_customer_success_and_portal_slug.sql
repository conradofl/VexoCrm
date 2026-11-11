-- Migration: Customer Success (Régua de Cuidado GD) e Portal Slug
-- Suporte à Frente 7: Portal em Tempo Real e Régua de CS Autônoma no WhatsApp

ALTER TABLE public.gd_clientes
  ADD COLUMN IF NOT EXISTS portal_slug                    text,
  ADD COLUMN IF NOT EXISTS cs_regua_ativa                 boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS cs_ultimo_toque_em             timestamptz,
  ADD COLUMN IF NOT EXISTS cs_toques_historico            jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cs_avaliacao_google_enviada_em   timestamptz,
  ADD COLUMN IF NOT EXISTS cs_proximo_toque_em            timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gd_clientes_portal_slug
  ON public.gd_clientes (portal_slug)
  WHERE portal_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gd_clientes_cs_regua
  ON public.gd_clientes (estado_atual, cs_regua_ativa, cs_proximo_toque_em)
  WHERE cs_regua_ativa IS TRUE;
