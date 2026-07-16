-- Arquivamento de contratos: some da lista principal sem apagar nada, e pode ser
-- consultado depois pela visão de arquivados. Idempotente e não-destrutivo.
ALTER TABLE public.gd_contracts
  ADD COLUMN IF NOT EXISTS arquivado boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_gd_contracts_arquivado ON public.gd_contracts (tenant_id, arquivado);
