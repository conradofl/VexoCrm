-- 1. Adiciona spin_fase a leads_infinie (já existe em leads_outlier com CHECK constraint)
ALTER TABLE public.leads_infinie
  ADD COLUMN IF NOT EXISTS spin_fase TEXT
  CHECK (spin_fase IS NULL OR spin_fase IN ('situacao', 'problema', 'implicacao', 'necessidade'));

-- Aplica em qualquer outra leads_{clientId} dinâmica já existente
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
    EXECUTE format(
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS spin_fase TEXT CHECK (spin_fase IS NULL OR spin_fase IN (''situacao'', ''problema'', ''implicacao'', ''necessidade''))',
      t.table_schema, t.table_name
    );
  END LOOP;
END $$;

-- 2. Atualiza prompts existentes para incluir spin_fase no formato JSON esperado da IA.
--    Só altera se o campo ainda não estiver presente (idempotente).
UPDATE chatbot_prompts
SET
  content = replace(
    content,
    '"finalizado": false',
    '"finalizado": false,' || chr(10) || '  "spin_fase": "situacao" | "problema" | "implicacao" | "necessidade"'
  ),
  updated_at = now()
WHERE type IN ('padrao', 'campanha')
  AND content LIKE '%"finalizado": false%'
  AND content NOT LIKE '%spin_fase%';
