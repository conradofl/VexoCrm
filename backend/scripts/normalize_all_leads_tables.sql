-- =============================================================
-- Normalização de todas as tabelas leads_* existentes
-- Seguro de rodar múltiplas vezes (IF NOT EXISTS / IF EXISTS)
-- =============================================================

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name LIKE 'leads_%'
      AND table_name NOT IN ('leads_clients')
  LOOP
    -- Colunas comuns a todos os chatbots
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS interesse        TEXT', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS objetivo         TEXT', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS cidade           TEXT', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS estado           TEXT', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS prazo            TEXT', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS melhor_horario   TEXT', t.table_name);

    -- Colunas Outlier (consórcios)
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS credito            TEXT', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS parcela            TEXT', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS lance_entrada_fgts TEXT', t.table_name);

    -- Colunas Infinie (solar)
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS conta_luz_faixa TEXT', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tipo            TEXT', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tipo_instalacao TEXT', t.table_name);

    -- Colunas de estado da conversa (caso não existam)
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS status_conversa TEXT', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS spin_fase       TEXT', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS finalizado      BOOLEAN DEFAULT false', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS dados           JSONB', t.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS mensagem        TEXT', t.table_name);

    RAISE NOTICE 'Normalizada: %', t.table_name;
  END LOOP;
END $$;

-- =============================================================
-- Tabela lead_messages (histórico de conversa por telefone)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.lead_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   TEXT        NOT NULL,
  lead_phone  TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'bot', 'lead')),
  content     TEXT        NOT NULL,
  media_type  TEXT,
  media_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_messages_lookup
  ON public.lead_messages (client_id, lead_phone, created_at);

-- =============================================================
-- Resultado: lista tabelas normalizadas
-- =============================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'leads_%'
  AND table_name != 'leads_clients'
ORDER BY table_name;
