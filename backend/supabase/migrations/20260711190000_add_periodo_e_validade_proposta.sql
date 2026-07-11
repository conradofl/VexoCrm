-- Período do plano fechado e validade da proposta (campos opcionais;
-- propostas antigas continuam válidas). Idempotente, não-destrutiva.
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS periodo_plano TEXT;
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS validade_ate TIMESTAMPTZ;
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS valor_apos_validade NUMERIC;
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS observacao_validade TEXT;
