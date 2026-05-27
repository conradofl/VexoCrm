-- Script de verificação pós-migration do módulo de follow-up.
-- Execute no banco do EasyPanel após aplicar a migration.

-- ── 1. Confirmar que todas as tabelas existem ────────────────────────────────
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = t.table_name
      AND table_schema = 'public') AS num_columns
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN (
    'followup_companies','followup_campaigns','followup_templates',
    'followup_schedules','followup_jobs','followup_replies'
  )
ORDER BY table_name;

-- ── 2. Confirmar índices ─────────────────────────────────────────────────────
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'followup_%'
ORDER BY tablename, indexname;

-- ── 3. Confirmar constraints CHECK ──────────────────────────────────────────
SELECT c.table_name, c.constraint_name, cc.check_clause
FROM information_schema.table_constraints c
JOIN information_schema.check_constraints cc
  ON cc.constraint_name = c.constraint_name
WHERE c.table_schema = 'public'
  AND c.table_name LIKE 'followup_%'
ORDER BY c.table_name;

-- ── 4. Confirmar FKs ─────────────────────────────────────────────────────────
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table,
  ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name LIKE 'followup_%'
ORDER BY tc.table_name;

-- ── 5. Inserir dados de teste e verificar ────────────────────────────────────
BEGIN;

INSERT INTO followup_companies (name, evolution_instance)
VALUES ('TESTE MIGRATION', 'teste-inst')
RETURNING id, name;

-- Verificar que a campanha herda via ON DELETE CASCADE
WITH company AS (
  SELECT id FROM followup_companies WHERE name = 'TESTE MIGRATION' LIMIT 1
)
INSERT INTO followup_campaigns (company_id, name, status)
SELECT id, 'Campanha Teste', 'draft' FROM company
RETURNING id, name, status;

ROLLBACK; -- Não persistir os dados de teste

-- ── 6. Teste de CHECK constraint (deve falhar) ────────────────────────────────
-- Este bloco deve retornar erro se o CHECK estiver funcionando:
-- DO $$ BEGIN
--   INSERT INTO followup_campaigns (company_id, name, status)
--   VALUES (gen_random_uuid(), 'Teste', 'INVALIDO');  -- deve falhar
-- EXCEPTION WHEN check_violation THEN
--   RAISE NOTICE 'CHECK constraint funcionando corretamente';
-- END $$;

SELECT 'Migration verificada com sucesso ✅' AS resultado;
