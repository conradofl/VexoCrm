-- Migration: Suporte a horário fixo (scheduled_time), campos âncora e gatilhos before_anchor / after_anchor
-- Data: 2026-09-14

ALTER TABLE public.followup_templates ADD COLUMN IF NOT EXISTS scheduled_time TIME NULL;
ALTER TABLE public.followup_templates ADD COLUMN IF NOT EXISTS anchor_field TEXT NULL;

-- Alterar CHECK constraint de trigger_type para aceitar before_anchor e after_anchor
ALTER TABLE public.followup_templates DROP CONSTRAINT IF EXISTS followup_templates_trigger_type_check;

ALTER TABLE public.followup_templates
  ADD CONSTRAINT followup_templates_trigger_type_check
  CHECK (trigger_type IN ('on_schedule', 'before_meeting', 'after_meeting', 'no_reply', 'after_enrollment', 'before_anchor', 'after_anchor'));
