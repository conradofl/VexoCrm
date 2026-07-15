-- Vários pacotes ofertados na proposta (menu que o cliente escolhe na proposta
-- pública). Array de package_ids. Opcional; idempotente e não-destrutiva.
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS pacotes_ofertados JSONB;
