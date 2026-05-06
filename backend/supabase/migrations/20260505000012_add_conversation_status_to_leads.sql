ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS status_conversa TEXT,
  ADD COLUMN IF NOT EXISTS ultima_interacao_bot TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultima_interacao_usuario TIMESTAMPTZ;

ALTER TABLE public.lead_import_items
  ADD COLUMN IF NOT EXISTS status_conversa TEXT,
  ADD COLUMN IF NOT EXISTS ultima_interacao_bot TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultima_interacao_usuario TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_status_conversa_check'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_status_conversa_check
      CHECK (
        status_conversa IS NULL
        OR status_conversa IN ('aguardando_usuario', 'em_atendimento', 'finalizado')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lead_import_items_status_conversa_check'
      AND conrelid = 'public.lead_import_items'::regclass
  ) THEN
    ALTER TABLE public.lead_import_items
      ADD CONSTRAINT lead_import_items_status_conversa_check
      CHECK (
        status_conversa IS NULL
        OR status_conversa IN ('aguardando_usuario', 'em_atendimento', 'finalizado')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_conversation_status_waiting
  ON public.leads (client_id, status_conversa, ultima_interacao_bot DESC);

CREATE INDEX IF NOT EXISTS idx_lead_import_items_conversation_status_waiting
  ON public.lead_import_items (client_id, status_conversa, ultima_interacao_bot DESC);
