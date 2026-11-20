-- Migration: 20261119230000_add_pessoal_to_whatsapp_chat_states.sql
-- Estado "pessoal" na conversa do WhatsApp: contato do celular do empresário que não é cliente
-- (família, amigo, fornecedor). Some da fila de trabalho, do "esperam resposta" do Dashboard e do
-- Plano de ação, e o robô não responde. Diferente de "arquivada", mensagem nova NÃO desfaz: só a
-- pessoa tira a marca. Só amplia a lista do CHECK; nenhuma linha muda.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'whatsapp_chat_states') THEN
    ALTER TABLE public.whatsapp_chat_states DROP CONSTRAINT IF EXISTS whatsapp_chat_states_state_check;
    ALTER TABLE public.whatsapp_chat_states
      ADD CONSTRAINT whatsapp_chat_states_state_check
      CHECK (state IN ('ativa', 'automacao', 'arquivada', 'lixeira', 'pessoal'));
  END IF;
END $$;
