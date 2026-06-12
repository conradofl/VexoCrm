-- Defeito A: elegibilidade idempotente por disparo.
-- Reutiliza a tabela equivalente já existente (campaign_dispatch_runs) em vez de
-- criar uma duplicada. Adiciona claim por lead: 1 registro por (disparo, lead),
-- marcado ANTES do envio, de modo que o mesmo lead nunca recebe 2x no MESMO disparo.
-- Escopo é POR DISPARO — disparos/campanhas futuras podem reusar o lead (follow-up preservado).

ALTER TABLE public.campaign_dispatch_runs
  ADD COLUMN IF NOT EXISTS lead_id    UUID,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- status passa a aceitar 'claimed' (reservado, antes do envio).
ALTER TABLE public.campaign_dispatch_runs
  DROP CONSTRAINT IF EXISTS campaign_dispatch_runs_status_check;
ALTER TABLE public.campaign_dispatch_runs
  ADD CONSTRAINT campaign_dispatch_runs_status_check
  CHECK (status IN ('pending', 'claimed', 'sent', 'failed', 'skipped'));

-- Guarda de idempotência: no máximo 1 registro por (disparo, lead).
-- No Postgres NULLs são distintos, então registros legados (lead_id NULL) não colidem
-- e o ON CONFLICT (dispatch_id, lead_id) cobre apenas os novos (lead_id preenchido).
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_dispatch_runs_dispatch_lead
  ON public.campaign_dispatch_runs (dispatch_id, lead_id);

-- Busca rápida dos falhados/claimed de um disparo (exportação e diagnóstico).
CREATE INDEX IF NOT EXISTS idx_campaign_dispatch_runs_dispatch_status
  ON public.campaign_dispatch_runs (dispatch_id, status);
