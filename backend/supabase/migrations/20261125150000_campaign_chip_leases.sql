-- Trava por chip no banco (PR 10d do untangle, 25/11/2026).
--
-- Um chip nunca dispara dois lotes ao mesmo tempo. Até aqui a trava vivia só na memória do processo
-- (campaign/chipDispatchLock.js): some no boot e não enxerga outro contêiner (deploy com dois no ar). Esta tabela é a
-- segunda camada: o lote reserva o(s) chip(s) aqui antes de sair e solta no fim.
--
-- chip_key: id do chip, ou '*' para lote sem chip definido (sai por qualquer chip da empresa e por isso conflita com
-- qualquer lote da mesma empresa). Reserva ativa = released_at nulo e expires_at no futuro. Reserva de processo morto
-- vence pelo prazo, ou é solta quando o lote dono chega a um status final.
--
-- Só cria; não altera nem apaga dado existente. O código tolera a tabela ausente (antes desta migration rodar, vale só
-- a trava em memória, como antes).

CREATE TABLE IF NOT EXISTS public.campaign_chip_leases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     text NOT NULL,
  chip_key      text NOT NULL,
  dispatch_id   uuid NOT NULL,
  dispatch_name text,
  holder        text,
  acquired_at   timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  released_at   timestamptz
);

-- Uma reserva ativa por chip da empresa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_chip_leases_active
  ON public.campaign_chip_leases (client_id, chip_key)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_chip_leases_dispatch
  ON public.campaign_chip_leases (dispatch_id)
  WHERE released_at IS NULL;
