-- PR 7 do untangle (25/11/2026): esquema de campaign_dispatches só na migration.
--
-- Até aqui domains/campaigns/routes.js derrubava e recriava este CHECK a cada pausa e a cada retomada
-- (ensureCampaignDispatchPausedStatusAllowed): ACCESS EXCLUSIVE na tabela e varredura inteira, no meio do disparo.
-- A lista é a mesma que o código gravava; em produção o CHECK já está assim (o código o recriava sempre),
-- então aqui só fica registrado para banco novo. As colunas também já vêm das migrations
-- 20261012120000 e 20261024150000; o ADD COLUMN IF NOT EXISTS não faz nada onde existe.
ALTER TABLE public.campaign_dispatches
  ADD COLUMN IF NOT EXISTS evolution_instance_id UUID,
  ADD COLUMN IF NOT EXISTS target_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatch_options JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.campaign_dispatches
  DROP CONSTRAINT IF EXISTS campaign_dispatches_status_check;

ALTER TABLE public.campaign_dispatches
  ADD CONSTRAINT campaign_dispatches_status_check
  CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'done', 'failed', 'cancelled', 'interrupted'));
