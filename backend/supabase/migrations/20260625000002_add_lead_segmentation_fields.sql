-- Migração para adicionar campos de segmentação e relacionamento da LivPub
-- Varre todas as tabelas de leads dinâmicas existentes no banco e adiciona as novas colunas.

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name LIKE 'leads_%' 
          AND table_name != 'leads_clients'
    LOOP
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS data_nascimento DATE', r.table_name);
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS ultima_visita DATE', r.table_name);
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS perfil_musical TEXT', r.table_name);
    END LOOP;
END;
$$;
