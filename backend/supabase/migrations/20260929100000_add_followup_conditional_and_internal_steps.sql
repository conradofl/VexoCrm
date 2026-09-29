-- Migration 20260929100000: Passos Condicionais e Ações Internas em followup_templates
ALTER TABLE public.followup_templates 
  ADD COLUMN IF NOT EXISTS step_type TEXT NOT NULL DEFAULT 'message',
  ADD COLUMN IF NOT EXISTS action_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS action_payload JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conditions JSONB DEFAULT '[]'::jsonb;

-- Validação de integridade para step_type e action_type
ALTER TABLE public.followup_templates DROP CONSTRAINT IF EXISTS followup_templates_step_type_check;
ALTER TABLE public.followup_templates
  ADD CONSTRAINT followup_templates_step_type_check
  CHECK (step_type IN ('message', 'internal_action'));

ALTER TABLE public.followup_templates DROP CONSTRAINT IF EXISTS followup_templates_action_type_check;
ALTER TABLE public.followup_templates
  ADD CONSTRAINT followup_templates_action_type_check
  CHECK (action_type IS NULL OR action_type IN ('create_reminder', 'change_stage', 'assign_operator', 'add_tag'));
