-- Remove legacy assistant tables that are not part of the CRM runtime.
-- This keeps the public schema aligned with the documented operational model.

DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE 'assistant\_%' ESCAPE '\'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', table_name);
  END LOOP;
END $$;
