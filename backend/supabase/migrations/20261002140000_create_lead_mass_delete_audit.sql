-- Migration 20261002140000: trilha de auditoria da exclusão em massa de leads (por tag / importação).
-- Operação irreversível sem rastro é o que impede descobrir o que aconteceu depois: quem apagou, com
-- que critério, quantos leads e quantos ficaram (e por qual motivo). A linha é gravada na MESMA
-- transação da exclusão — não existe exclusão sem registro.
CREATE TABLE IF NOT EXISTS public.lead_mass_delete_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  user_uid TEXT,
  user_email TEXT,
  criterion JSONB NOT NULL,
  options JSONB NOT NULL,
  matched INTEGER NOT NULL,
  expected_count INTEGER NOT NULL,
  deleted INTEGER NOT NULL,
  kept INTEGER NOT NULL,
  kept_multi_import INTEGER NOT NULL DEFAULT 0,
  kept_with_messages INTEGER NOT NULL DEFAULT 0,
  kept_both INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_mass_delete_audit_client
  ON public.lead_mass_delete_audit (client_id, created_at DESC);
