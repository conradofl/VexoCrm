-- Tabela de sugestões proativas geradas pelo motor de automação.
-- Operadores aprovam ou rejeitam antes de qualquer envio.

CREATE TABLE IF NOT EXISTS followup_suggestions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        REFERENCES followup_companies(id)  ON DELETE CASCADE,
  campaign_id           UUID        REFERENCES followup_campaigns(id)  ON DELETE SET NULL,
  lead_name             TEXT,
  phone                 TEXT,
  lead_source           TEXT,
  reason                TEXT        NOT NULL,
  suggested_template_id UUID        REFERENCES followup_templates(id)  ON DELETE SET NULL,
  suggested_message     TEXT,
  status                TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by           TEXT,
  approved_at           TIMESTAMPTZ,
  executed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS followup_suggestions_company_idx ON followup_suggestions (company_id);
CREATE INDEX IF NOT EXISTS followup_suggestions_status_idx  ON followup_suggestions (status);
CREATE INDEX IF NOT EXISTS followup_suggestions_created_idx ON followup_suggestions (created_at DESC);
CREATE INDEX IF NOT EXISTS followup_suggestions_phone_idx   ON followup_suggestions (phone);
