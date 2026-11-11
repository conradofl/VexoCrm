-- Migration: Síntese de Documentos de Briefing e Fluxo de Aprovação no WhatsApp
-- Suporte a Frente 5: Motor de Síntese Gemini dos 4 Documentos e Aprovação Multi-Etapa

ALTER TABLE public.gd_clientes
  ADD COLUMN IF NOT EXISTS grupo_interno_jid                   text,
  ADD COLUMN IF NOT EXISTS grupo_cliente_jid                   text,
  ADD COLUMN IF NOT EXISTS briefing_documentos                 jsonb,
  ADD COLUMN IF NOT EXISTS briefing_aprovacao_interna_status    text,
  ADD COLUMN IF NOT EXISTS briefing_aprovacao_interna_ressalvas text,
  ADD COLUMN IF NOT EXISTS briefing_aprovacao_interna_em       timestamptz,
  ADD COLUMN IF NOT EXISTS briefing_aprovacao_cliente_status   text,
  ADD COLUMN IF NOT EXISTS briefing_aprovacao_cliente_em       timestamptz,
  ADD COLUMN IF NOT EXISTS briefing_transcricao                text,
  ADD COLUMN IF NOT EXISTS briefing_formulario_respostas       jsonb;

CREATE INDEX IF NOT EXISTS idx_gd_clientes_aprovacao_interna
  ON public.gd_clientes (grupo_interno_jid, briefing_aprovacao_interna_status)
  WHERE grupo_interno_jid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gd_clientes_aprovacao_cliente
  ON public.gd_clientes (grupo_cliente_jid, briefing_aprovacao_cliente_status)
  WHERE grupo_cliente_jid IS NOT NULL;
