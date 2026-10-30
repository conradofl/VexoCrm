-- Migration: 20261030160000_add_human_takeover_agent_pause.sql
-- Etiqueta de atendimento humano (pedido da Container Led, 30/10/2026).
-- Aplicada à mão em produção ANTES do código. Idempotente.

-- D3: resposta humana (pela tela de Conversas, depois pelo celular) pausa o agente
-- naquela conversa. Por tenant e nasce desligada: quem tem gente digitando o dia
-- inteiro calaria o agente em todas as conversas se isso ligasse para todo mundo.
ALTER TABLE public.lead_client_n8n_settings
  ADD COLUMN IF NOT EXISTS agent_pause_on_device_reply BOOLEAN NOT NULL DEFAULT false;

-- Quem pausou: 'classificador' (conversa não-comercial), 'manual' (gente, pela tela).
-- NULL = linha anterior a esta coluna, sempre do classificador. Só a pausa do
-- classificador conta no freio diário e só ela se desfaz com resposta fromMe.
ALTER TABLE public.whatsapp_chat_states
  ADD COLUMN IF NOT EXISTS agent_muted_source TEXT NULL;

COMMENT ON COLUMN public.lead_client_n8n_settings.agent_pause_on_device_reply IS 'Resposta humana na conversa pausa o agente ali. Por tenant, padrão desligado.';
COMMENT ON COLUMN public.whatsapp_chat_states.agent_muted_source IS 'Origem da pausa do agente: classificador | manual. NULL = classificador (linhas antigas).';
