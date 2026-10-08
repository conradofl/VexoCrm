-- Migration: Add recurrence columns to public.campaigns table (Pilar 3)
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_pattern TEXT,
  ADD COLUMN IF NOT EXISTS recurrence_day_of_month INT,
  ADD COLUMN IF NOT EXISTS recurrence_day_of_week INT,
  ADD COLUMN IF NOT EXISTS recurrence_time TEXT DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;

COMMENT ON COLUMN public.campaigns.is_recurring IS 'Indica se a campanha deve se repetir ciclicamente de forma automatica';
COMMENT ON COLUMN public.campaigns.recurrence_pattern IS 'Padrao de recorrencia: monthly, weekly, biweekly';
COMMENT ON COLUMN public.campaigns.recurrence_day_of_month IS 'Dia fixo do mes para disparo (1 a 31)';
COMMENT ON COLUMN public.campaigns.recurrence_day_of_week IS 'Dia fixo da semana para disparo (0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sab)';
COMMENT ON COLUMN public.campaigns.recurrence_time IS 'Horario de disparo no formato HH:mm';
COMMENT ON COLUMN public.campaigns.next_run_at IS 'Data/hora calculada para a proxima execucao do ciclo';
