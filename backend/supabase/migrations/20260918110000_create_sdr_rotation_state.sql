-- Migration 20260918110000: sdr_rotation_state — a volta do rodízio de SDR.
-- Um cursor por tenant, incrementado atomicamente (mesmo padrão de
-- evolution_instance_daily_usage/chipQuota.js). Precisa sobreviver a
-- reinício do servidor: sem tabela, a volta reiniciaria sempre no primeiro
-- consultor, e o primeiro receberia tudo.

CREATE TABLE IF NOT EXISTS public.sdr_rotation_state (
  client_id  TEXT        PRIMARY KEY,
  cursor     INTEGER     NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
