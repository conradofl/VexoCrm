-- Migration: 20261029200000_create_campaign_queue_deferrals.sql
-- Marcador de "fila adiada": quando um freio (janela de envio fechada, cota do chip esgotada) barra o início do próximo lead
-- da fila de resposta (startNextCampaignLeadInQueue), a campanha fica registrada aqui até a próxima oportunidade.
-- O agendador de 30s retoma quando retry_after vence; maybeFinalizeCampaignAfterReply não encerra a campanha enquanto
-- houver linha aqui (leads ainda não iniciados não contam no fechamento).
-- Estado operacional: fica em tabela própria de propósito, nunca dentro de JSON que a tela de edição reescreve.
--
-- DEPLOY: aplicar esta migration ANTES do código que a usa. O código tolera a tabela ausente (registra erro e segue sem
-- adiar), mas sem a tabela o freio bloqueia sem marcador e a fila só volta quando outra resposta chegar.
CREATE TABLE IF NOT EXISTS public.campaign_queue_deferrals (
  campaign_id UUID PRIMARY KEY REFERENCES public.campaigns(id) ON DELETE CASCADE,
  client_id   TEXT        NOT NULL,
  reason      TEXT        NOT NULL CHECK (reason IN ('send_window', 'chip_quota')),
  deferred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retry_after TIMESTAMPTZ NOT NULL,
  attempts    INT         NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_queue_deferrals_retry_after
  ON public.campaign_queue_deferrals (retry_after);

ALTER TABLE public.campaign_queue_deferrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all direct access to campaign_queue_deferrals" ON public.campaign_queue_deferrals;
CREATE POLICY "Deny all direct access to campaign_queue_deferrals"
  ON public.campaign_queue_deferrals FOR ALL USING (false);
