-- Opt-out: tira a chave única antiga de public.lead_optouts.
--
-- A tabela nasceu fora das migrations com UNIQUE (client_id, phone), medida em produção em 14/11/2026
-- (lead_optouts_client_id_phone_key). Essa chave vale também para linha revogada. Com ela, revogar e pedir de novo
-- não cria linha nova: o INSERT ... ON CONFLICT (client_id, phone) WHERE revoked_at IS NULL DO NOTHING de
-- services/optOut.js trata a linha revogada como conflito e descarta o pedido em silêncio, e o número segue liberado.
--
-- A regra certa já existe desde 20261112010000: um pedido ATIVO por empresa e número (uq_lead_optouts_ativo, parcial).
-- Esta migration apaga qualquer chave única NÃO parcial exatamente em (client_id, phone), seja constraint ou índice,
-- qualquer que seja o nome. A chave primária e o índice parcial ficam. Idempotente.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname = 'lead_optouts' AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(c.conkey) k
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k) = ARRAY['client_id', 'phone']
  LOOP
    EXECUTE format('ALTER TABLE public.lead_optouts DROP CONSTRAINT %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT ic.relname AS indexname
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname = 'lead_optouts'
       AND i.indisunique AND NOT i.indisprimary AND i.indpred IS NULL AND i.indexprs IS NULL
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(i.indkey::int2[]) k
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k) = ARRAY['client_id', 'phone']
  LOOP
    EXECUTE format('DROP INDEX public.%I', r.indexname);
  END LOOP;
END $$;
