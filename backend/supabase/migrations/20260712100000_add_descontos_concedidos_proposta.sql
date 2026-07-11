-- Registro das concessões feitas na mesa de negociação
-- (lista de {tipo, valor_original, valor_final, motivo}). Campo opcional;
-- propostas antigas continuam válidas. Idempotente, não-destrutiva.
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS descontos_concedidos JSONB;
