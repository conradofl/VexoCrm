-- Migration: 20261031000000_agent_pause_expiry.sql
-- A pausa de atendimento humano expira sozinha (PR 2 da etiqueta, pedido da Container Led).
-- Aplicada à mão em produção ANTES do código. Idempotente.

-- Relógio da expiração: último fromMe (tela ou aparelho) enquanto a conversa está pausada
-- à mão. NULL = conta a partir de agent_muted_at. Coluna própria para agent_muted_at
-- continuar dizendo só "pausado desde quando".
ALTER TABLE public.whatsapp_chat_states
  ADD COLUMN IF NOT EXISTS agent_mute_last_human_at TIMESTAMPTZ NULL;

-- Dias sem contato da equipe até a pausa manual sair sozinha. 0 = nunca expira.
ALTER TABLE public.lead_client_n8n_settings
  ADD COLUMN IF NOT EXISTS agent_pause_expiry_days INTEGER NOT NULL DEFAULT 3;

COMMENT ON COLUMN public.whatsapp_chat_states.agent_mute_last_human_at IS 'Último contato da equipe (fromMe) com a conversa pausada à mão. NULL = usar agent_muted_at.';
COMMENT ON COLUMN public.lead_client_n8n_settings.agent_pause_expiry_days IS 'Dias sem contato da equipe até a pausa manual expirar. 0 = nunca expira.';
