-- Modo de operação da campanha:
--   disparo  → envia os passos, lead responde → chatbot padrão (sem prompt campanha)
--   agente   → envia os passos, lead responde dentro do período → chatbot usa prompt campanha

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'disparo'
  CHECK (mode IN ('disparo', 'agente'));

COMMENT ON COLUMN public.campaigns.mode IS
  'disparo: só envia mensagens, sem agente IA na resposta. agente: chatbot usa prompt campanha durante o período ativo.';
