-- Migration: Briefing Comercial Vexo, Mineração WhatsApp e Configuração de Chips Virtuais
-- Suporte à Frente 6: Registro de Chips Virtuais (Gabriel 72h), Mineração de WhatsApp com Gemini e 4 Pilares da IA

ALTER TABLE public.gd_clientes
  ADD COLUMN IF NOT EXISTS vexto_briefing_chips             jsonb,
  ADD COLUMN IF NOT EXISTS vexto_briefing_transbordo_numero  text,
  ADD COLUMN IF NOT EXISTS vexto_briefing_pilares           jsonb,
  ADD COLUMN IF NOT EXISTS vexto_briefing_mineracao         jsonb,
  ADD COLUMN IF NOT EXISTS vexto_briefing_prompt_gerado     text,
  ADD COLUMN IF NOT EXISTS vexto_briefing_status            text DEFAULT 'PENDENTE',
  ADD COLUMN IF NOT EXISTS vexto_briefing_agente_id         uuid;

CREATE INDEX IF NOT EXISTS idx_gd_clientes_vexto_status
  ON public.gd_clientes (vexto_briefing_status);
