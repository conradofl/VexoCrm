-- Migration 20261003090000: trilha de auditoria da correção de origem "Instagram Direct" dos leads.
-- Quem corrigiu, quantos leads (por grupo), quantos ficaram sem correção e QUAIS leads foram corrigidos
-- (lead_ids) — o valor antigo era sempre "Instagram Direct", então a lista basta para desfazer.
-- A linha é gravada na MESMA transação da correção.
CREATE TABLE IF NOT EXISTS public.lead_origin_fix_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  user_uid TEXT,
  user_email TEXT,
  expected_count INTEGER NOT NULL,
  corrected INTEGER NOT NULL,
  corrected_with_import_id INTEGER NOT NULL DEFAULT 0,
  corrected_only_import_tag INTEGER NOT NULL DEFAULT 0,
  left_undeterminable INTEGER NOT NULL DEFAULT 0,
  left_instagram_importer INTEGER NOT NULL DEFAULT 0,
  lead_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_origin_fix_audit_client
  ON public.lead_origin_fix_audit (client_id, created_at DESC);
