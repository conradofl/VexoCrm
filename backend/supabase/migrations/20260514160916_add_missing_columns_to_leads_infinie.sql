-- Migration: alinha leads_infinie ao schema esperado pelo chatbot e endpoints
--
-- Contexto: leads_infinie (ex tabela leads) tem o schema original de 2024
-- sem as colunas adicionadas ao chatbot em maio/2026. O endpoint
-- GET /api/hardcoded-chat-leads faz SELECT de colunas que não existem.
--
-- Colunas dados, finalizado e status_conversa já foram adicionadas manualmente.
-- Esta migration adiciona as restantes.

ALTER TABLE public.leads_infinie
  ADD COLUMN IF NOT EXISTS mensagem TEXT,
  ADD COLUMN IF NOT EXISTS spin_fase TEXT CHECK (spin_fase IS NULL OR spin_fase IN ('situacao', 'problema', 'implicacao', 'necessidade')),
  ADD COLUMN IF NOT EXISTS lead_temperature TEXT CHECK (lead_temperature IS NULL OR lead_temperature IN ('QUENTE', 'MORNO', 'FRIO')),
  ADD COLUMN IF NOT EXISTS lead_score NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS lead_origin TEXT,
  ADD COLUMN IF NOT EXISTS source_campaign_id UUID,
  ADD COLUMN IF NOT EXISTS behavior_meta JSONB DEFAULT '{}'::jsonb;
