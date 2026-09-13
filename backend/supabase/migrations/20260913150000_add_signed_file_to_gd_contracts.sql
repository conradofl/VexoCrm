-- Migration: 20260913150000_add_signed_file_to_gd_contracts.sql
-- Adiciona campos para armazenamento e histórico de versões do contrato assinado (ex: gov.br).

ALTER TABLE public.gd_contracts
  ADD COLUMN IF NOT EXISTS signed_file_path TEXT,
  ADD COLUMN IF NOT EXISTS signed_file_name TEXT,
  ADD COLUMN IF NOT EXISTS signed_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_uploaded_by TEXT,
  ADD COLUMN IF NOT EXISTS signed_file_history JSONB DEFAULT '[]'::jsonb;
