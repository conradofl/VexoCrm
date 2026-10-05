-- evolution_instance_daily_usage.instance_id: um tipo só (TEXT), em todo banco.
-- Houve dois criadores (services/evolution.js como UUID, services/chipQuota.js como TEXT) e leitores que assumiam
-- cada um dos tipos. TEXT é o destino porque UUID -> TEXT nunca perde dado (TEXT -> UUID falharia se existisse um
-- valor que não é UUID). Idempotente: cria a tabela se não existe e só converte se a coluna ainda não é TEXT.
-- Derruba antes as FKs da tabela (a de junho nasceu REFERENCES lead_client_evolution_instances): com a FK o Postgres
-- recusa o ALTER — e uma migration que falha derruba a subida do container (start.sh: set -e).
-- O bloco DO é o MESMO de CONVERGE_USAGE_INSTANCE_ID_SQL em backend/src/services/chipQuota.js (um teste confere).
CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_usage (
  instance_id TEXT NOT NULL,
  date DATE NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (instance_id, date)
);

DO $$
DECLARE fk record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'evolution_instance_daily_usage'
       AND column_name = 'instance_id' AND data_type <> 'text'
  ) THEN
    FOR fk IN
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'public.evolution_instance_daily_usage'::regclass AND contype = 'f'
    LOOP
      EXECUTE format('ALTER TABLE public.evolution_instance_daily_usage DROP CONSTRAINT %I', fk.conname);
    END LOOP;
    ALTER TABLE public.evolution_instance_daily_usage ALTER COLUMN instance_id TYPE TEXT USING instance_id::text;
  END IF;
END $$;
