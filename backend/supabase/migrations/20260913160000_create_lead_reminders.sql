-- Migration 20260913160000: Criação da tabela lead_reminders para tarefas e lembretes internos
-- Permite agendar tarefas internas por lead/contato sem enviar mensagem ao cliente.
-- Telefones são gravados de forma canônica na escrita via toCanonicalPhone(raw).

CREATE TABLE IF NOT EXISTS public.lead_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  lead_id UUID,
  phone TEXT NOT NULL,
  lead_name TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  remind_at TIMESTAMPTZ NOT NULL,
  assigned_to_uid TEXT,
  assigned_to_name TEXT,
  created_by_uid TEXT,
  created_by_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  completed_by_uid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice composto por client_id e phone (telefone canônico gravado na escrita)
CREATE INDEX IF NOT EXISTS idx_lead_reminders_client_phone
  ON public.lead_reminders (client_id, phone);

-- Índice para consultas de pendências por status e data de lembrete
CREATE INDEX IF NOT EXISTS idx_lead_reminders_client_status_remind
  ON public.lead_reminders (client_id, status, remind_at);
