-- Migration 20260908180000: Adiciona coluna ticket_medio na tabela public.leads_clients
-- Idempotente: ADD COLUMN IF NOT EXISTS

ALTER TABLE public.leads_clients
  ADD COLUMN IF NOT EXISTS ticket_medio NUMERIC(12,2) NULL;
