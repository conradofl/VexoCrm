-- E-mail da Agenda Google do cliente da Geração Digital para automação de reuniões de alinhamento / onboarding.

ALTER TABLE public.gd_clientes
  ADD COLUMN IF NOT EXISTS google_calendar_email text;

ALTER TABLE public.gd_clientes DROP CONSTRAINT IF EXISTS gd_clientes_google_calendar_email_check;
ALTER TABLE public.gd_clientes ADD CONSTRAINT gd_clientes_google_calendar_email_check
  CHECK (google_calendar_email IS NULL OR (length(trim(google_calendar_email)) > 0 AND length(google_calendar_email) <= 255));
