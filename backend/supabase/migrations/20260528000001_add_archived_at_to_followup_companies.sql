-- Adiciona soft-delete à tabela followup_companies.
-- Empresas arquivadas são ocultadas de todos os dropdowns e filtros do sistema.
-- As campanhas, schedules e demais dados relacionados são preservados (sem cascade delete).

ALTER TABLE followup_companies
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_followup_companies_archived_at
  ON followup_companies (archived_at)
  WHERE archived_at IS NULL;
