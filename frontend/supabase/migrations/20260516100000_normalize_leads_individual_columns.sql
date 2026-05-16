-- Normalização das tabelas de leads: adiciona colunas individuais para dados coletados
-- pelo chatbot SPIN, que até agora ficavam apenas no JSONB `dados`.
-- Mantém `dados` como backup histórico; as colunas permitem queries diretas e Kanban filtrado.

-- ============================================================
-- Colunas COMUNS para leads_infinie e leads_outlier
-- ============================================================

ALTER TABLE public.leads_infinie
  ADD COLUMN IF NOT EXISTS interesse        TEXT,
  ADD COLUMN IF NOT EXISTS objetivo         TEXT,
  ADD COLUMN IF NOT EXISTS prazo            TEXT,
  ADD COLUMN IF NOT EXISTS melhor_horario   TEXT;

ALTER TABLE public.leads_outlier
  ADD COLUMN IF NOT EXISTS interesse        TEXT,
  ADD COLUMN IF NOT EXISTS objetivo         TEXT,
  ADD COLUMN IF NOT EXISTS prazo            TEXT,
  ADD COLUMN IF NOT EXISTS melhor_horario   TEXT;

-- Aplica também em qualquer outra tabela leads_* dinâmica criada pelo sistema
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name LIKE 'leads_%'
      AND table_name NOT IN ('leads_clients', 'leads_infinie', 'leads_outlier')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS interesse      TEXT', t.table_schema, t.table_name);
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS objetivo       TEXT', t.table_schema, t.table_name);
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS prazo          TEXT', t.table_schema, t.table_name);
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS melhor_horario TEXT', t.table_schema, t.table_name);
  END LOOP;
END $$;

-- ============================================================
-- Colunas OUTLIER-específicas
-- ============================================================

ALTER TABLE public.leads_outlier
  ADD COLUMN IF NOT EXISTS credito            TEXT,
  ADD COLUMN IF NOT EXISTS parcela            TEXT,
  ADD COLUMN IF NOT EXISTS lance_entrada_fgts TEXT;

-- ============================================================
-- Colunas INFINIE-específicas (solar)
-- ============================================================

ALTER TABLE public.leads_infinie
  ADD COLUMN IF NOT EXISTS tipo_instalacao  TEXT,
  ADD COLUMN IF NOT EXISTS conta_luz_faixa  TEXT;

-- ============================================================
-- Tabela lead_messages — histórico de conversa normalizado
-- Substitui o campo `historico` TEXT/JSONB nas tabelas de leads
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lead_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   TEXT        NOT NULL,
  lead_phone  TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT        NOT NULL,
  media_type  TEXT,
  media_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_messages_lookup
  ON public.lead_messages (client_id, lead_phone, created_at);

ALTER TABLE public.lead_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all direct access to lead_messages"
ON public.lead_messages;

CREATE POLICY "Deny all direct access to lead_messages"
ON public.lead_messages
FOR ALL
USING (false);
