-- Migration: Suporte a data fixa (scheduled_date) em followup_templates e dispatch_jitter_minutes em followup_campaigns
-- Data: 2026-09-15

ALTER TABLE public.followup_templates ADD COLUMN IF NOT EXISTS scheduled_date DATE NULL;
ALTER TABLE public.followup_campaigns ADD COLUMN IF NOT EXISTS dispatch_jitter_minutes INTEGER NOT NULL DEFAULT 0;

-- Recriar CHECK constraint de trigger_type para aceitar fixed_date de forma idempotente
ALTER TABLE public.followup_templates DROP CONSTRAINT IF EXISTS followup_templates_trigger_type_check;

ALTER TABLE public.followup_templates
  ADD CONSTRAINT followup_templates_trigger_type_check
  CHECK (trigger_type IN ('on_schedule', 'before_meeting', 'after_meeting', 'no_reply', 'after_enrollment', 'before_anchor', 'after_anchor', 'fixed_date'));
