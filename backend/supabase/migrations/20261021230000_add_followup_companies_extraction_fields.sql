-- Migration: Adicionar campos de extração de briefing para o closer no agente inbound
-- inbound_extraction_prompt: prompt customizado de extração para o closer (herda de chatbot_prompts tipo 'extrato' quando NULL)
-- inbound_extraction_enabled: seletor liga/desliga a extração de briefing para este agente (DEFAULT TRUE preserva comportamento atual)

ALTER TABLE public.followup_companies
  ADD COLUMN IF NOT EXISTS inbound_extraction_prompt TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS inbound_extraction_enabled BOOLEAN DEFAULT TRUE;
