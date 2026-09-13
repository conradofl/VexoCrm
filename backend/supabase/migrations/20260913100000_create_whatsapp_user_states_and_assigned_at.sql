-- Migration 20260913100000_create_whatsapp_user_states_and_assigned_at.sql
-- 1. Coluna assigned_at em public.leads para rastreamento de atribuição
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_leads_client_assigned
  ON public.leads (client_id, assigned_to, assigned_at);

-- Preenchimento inicial para leads que já possuem assigned_to (data da última interação ou criação)
UPDATE public.leads
SET assigned_at = COALESCE(last_interaction_at, updated_at, created_at, now())
WHERE assigned_to IS NOT NULL AND assigned_at IS NULL;

-- 2. Colunas de exclusão global em public.lead_messages
ALTER TABLE public.lead_messages
  ADD COLUMN IF NOT EXISTS deleted_for_all BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_messages_deleted_for_all
  ON public.lead_messages (client_id, deleted_for_all);

-- 3. Tabela de estado de conversa por usuário (last_opened_at e cleared_at)
CREATE TABLE IF NOT EXISTS public.whatsapp_user_chat_states (
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  last_opened_at TIMESTAMPTZ NULL,
  cleared_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, user_id, phone)
);

-- Baseline limpo: para leads atribuídos já existentes, inicializa last_opened_at = assigned_at para o contador começar zerado.
-- O telefone é obrigatoriamente canônico (SQL_CANONICAL_PHONE) para casar perfeitamente com latest_messages na consulta do contador.
INSERT INTO public.whatsapp_user_chat_states (client_id, user_id, phone, last_opened_at, created_at, updated_at)
SELECT 
  client_id, 
  assigned_to, 
  CASE
    WHEN telefone LIKE '%@%' THEN telefone
    WHEN length(regexp_replace(telefone, '\D', '', 'g')) = 12 AND regexp_replace(telefone, '\D', '', 'g') ~ '^55[1-9]{2}[6-9]'
      THEN '55' || substr(regexp_replace(telefone, '\D', '', 'g'), 3, 2) || '9' || substr(regexp_replace(telefone, '\D', '', 'g'), 5)
    WHEN length(regexp_replace(telefone, '\D', '', 'g')) = 10 AND regexp_replace(telefone, '\D', '', 'g') ~ '^[1-9]{2}[6-9]'
      THEN '55' || substr(regexp_replace(telefone, '\D', '', 'g'), 1, 2) || '9' || substr(regexp_replace(telefone, '\D', '', 'g'), 3)
    WHEN length(regexp_replace(telefone, '\D', '', 'g')) = 10 AND regexp_replace(telefone, '\D', '', 'g') ~ '^[1-9]{2}[2-5]'
      THEN '55' || regexp_replace(telefone, '\D', '', 'g')
    WHEN length(regexp_replace(telefone, '\D', '', 'g')) = 11 AND regexp_replace(telefone, '\D', '', 'g') ~ '^[1-9]{2}9'
      THEN '55' || regexp_replace(telefone, '\D', '', 'g')
    ELSE regexp_replace(telefone, '\D', '', 'g')
  END AS phone, 
  COALESCE(assigned_at, now()), 
  now(), 
  now()
FROM public.leads
WHERE assigned_to IS NOT NULL 
  AND telefone IS NOT NULL 
  AND length(regexp_replace(telefone, '\D', '', 'g')) >= 8
ON CONFLICT (client_id, user_id, phone) DO NOTHING;

-- 4. Tabela de mensagens apagadas por usuário ("Apagar para mim") — message_id é UUID
CREATE TABLE IF NOT EXISTS public.whatsapp_user_hidden_messages (
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_id UUID NOT NULL,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, user_id, message_id)
);
