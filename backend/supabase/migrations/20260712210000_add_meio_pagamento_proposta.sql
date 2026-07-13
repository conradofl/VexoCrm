-- Meio de pagamento definido na mesa de negociação: {"setup": "pix", "mensalidade": "boleto"}.
-- Campo opcional; propostas antigas continuam válidas. Idempotente, não-destrutiva.
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS meio_pagamento JSONB;
