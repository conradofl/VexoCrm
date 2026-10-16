-- Migration 20261016140000: Suporte a chamadas, reuniões e Google Meet em lead_reminders
ALTER TABLE public.lead_reminders
ADD COLUMN IF NOT EXISTS activity_type TEXT DEFAULT 'reminder', -- 'meeting', 'call', 'reminder'
ADD COLUMN IF NOT EXISTS meeting_url TEXT, -- Link do Google Meet
ADD COLUMN IF NOT EXISTS call_status TEXT, -- 'answered', 'no_answer', 'busy', 'voicemail'
ADD COLUMN IF NOT EXISTS meeting_outcome TEXT; -- 'won', 'proposal', 'rescheduled', 'no_show', 'lost'

CREATE INDEX IF NOT EXISTS idx_lead_reminders_activity_type
  ON public.lead_reminders (client_id, activity_type);
