-- Colunas usadas pelas rotas de campanhas/followup no runtime PostgreSQL direto.
-- As tabelas leads_{clientId} sao dinamicas, entao aplicamos nas existentes.

ALTER TABLE IF EXISTS public.lead_import_items
  ADD COLUMN IF NOT EXISTS nome text;

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
      AND table_name <> 'leads_clients'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS source_campaign_name text', t.table_schema, t.table_name);
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS lead_source text', t.table_schema, t.table_name);
  END LOOP;
END $$;
