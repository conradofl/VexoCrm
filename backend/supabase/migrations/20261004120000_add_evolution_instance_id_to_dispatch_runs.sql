-- Migration 20261004120000: grava o identificador da instância (chip) que realmente enviou em campaign_dispatch_runs.
-- O ranking de chips do dashboard passa a atribuir por essa coluna, separando envios de campanha da cota diária.
-- Se o chip não for conhecido naquele envio, a coluna fica nula ("sem chip registrado").
ALTER TABLE public.campaign_dispatch_runs
  ADD COLUMN IF NOT EXISTS evolution_instance_id UUID;

CREATE INDEX IF NOT EXISTS idx_campaign_dispatch_runs_instance
  ON public.campaign_dispatch_runs (evolution_instance_id)
  WHERE evolution_instance_id IS NOT NULL;
