-- Migration 20261024130000: registro e trava de execuções da auditoria diária Trello -> Slack
-- Evita disparos duplicados durante zero-downtime deploy através da constraint UNIQUE em slot_key
-- e mantém rastreabilidade de horários, status, entregas ao Slack e falhas de APIs externas.

CREATE TABLE IF NOT EXISTS public.trello_slack_audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'running',
  sent BOOLEAN NOT NULL DEFAULT false,
  report_summary JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trello_slack_audit_runs_slot_key_unique UNIQUE (slot_key)
);

CREATE INDEX IF NOT EXISTS idx_trello_slack_audit_runs_slot_key
  ON public.trello_slack_audit_runs (slot_key);

CREATE INDEX IF NOT EXISTS idx_trello_slack_audit_runs_executed_at
  ON public.trello_slack_audit_runs (executed_at DESC);
