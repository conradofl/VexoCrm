-- Adiciona campos de customização para varredura e atraso de followup
ALTER TABLE public.followup_companies
  ADD COLUMN IF NOT EXISTS engine_scan_interval_hours INTEGER DEFAULT 6,
  ADD COLUMN IF NOT EXISTS never_contacted_delay_hours INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS no_reply_delay_hours INTEGER DEFAULT 48,
  ADD COLUMN IF NOT EXISTS livpub_inactive_delay_months INTEGER DEFAULT 6,
  ADD COLUMN IF NOT EXISTS last_engine_run_at TIMESTAMPTZ DEFAULT NULL;
