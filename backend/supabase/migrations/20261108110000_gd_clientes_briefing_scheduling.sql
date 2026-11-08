-- Migration: Agendador Autônomo de Briefing (Google Calendar, oferta de horários e lembretes WhatsApp)
-- Suporte a Frente 4: Agendador de Briefing da Geração Digital.

ALTER TABLE public.gd_clientes
  ADD COLUMN IF NOT EXISTS briefing_slots_oferecidos             jsonb,
  ADD COLUMN IF NOT EXISTS briefing_agendado_inicio              timestamptz,
  ADD COLUMN IF NOT EXISTS briefing_agendado_fim                 timestamptz,
  ADD COLUMN IF NOT EXISTS briefing_meet_url                     text,
  ADD COLUMN IF NOT EXISTS briefing_calendar_event_id            text,
  ADD COLUMN IF NOT EXISTS briefing_lembrete_vespera_agendado_para timestamptz,
  ADD COLUMN IF NOT EXISTS briefing_lembrete_vespera_enviado_em   timestamptz,
  ADD COLUMN IF NOT EXISTS briefing_lembrete_1h_agendado_para     timestamptz,
  ADD COLUMN IF NOT EXISTS briefing_lembrete_1h_enviado_em        timestamptz;

CREATE INDEX IF NOT EXISTS idx_gd_clientes_briefing_lembretes
  ON public.gd_clientes (estado_atual, briefing_agendado_inicio)
  WHERE estado_atual = 'BRIEFING_AGENDADO';
