-- Migration: 20260911120000_add_agent_muted_to_whatsapp_chat_states.sql
-- Adiciona agent_muted_at e agent_muted_reason à public.whatsapp_chat_states para silenciar o robô sem mudar o state ('ativa')

ALTER TABLE public.whatsapp_chat_states
  ADD COLUMN IF NOT EXISTS agent_muted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS agent_muted_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_states_client_muted
  ON public.whatsapp_chat_states (client_id, agent_muted_at)
  WHERE agent_muted_at IS NOT NULL;

COMMENT ON COLUMN public.whatsapp_chat_states.agent_muted_at IS 'Data/hora em que o robô foi silenciado por detecção de conversa não-comercial. State continua ativa.';
COMMENT ON COLUMN public.whatsapp_chat_states.agent_muted_reason IS 'Motivo do silenciamento do agente (ex: conversa pessoal, engano, pedido de comida).';
