-- ==============================================================================
-- Migration: Adicionar coluna assigned_chip na tabela leads
-- Usado pelo Transbordo / Handoff Ativo de Chips em Campanhas
-- ==============================================================================

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_chip TEXT;
