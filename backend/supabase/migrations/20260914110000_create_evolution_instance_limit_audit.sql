-- Migration: Auditoria de alterações de limite diário de chips (daily_limit_override)
-- Data: 2026-09-14

CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_limit_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  previous_limit INTEGER,
  new_limit INTEGER,
  changed_by_uid TEXT,
  changed_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evolution_instance_daily_limit_audit_instance
  ON public.evolution_instance_daily_limit_audit (instance_id, created_at DESC);
