-- 20260912140000_add_esconder_valores_to_gd_proposals.sql
-- Adiciona a coluna esconder_valores na tabela public.gd_proposals
-- Permite que propostas comerciais ocultem os valores e preços dos planos
-- para negociações customizadas / sob consulta, mantendo o escopo e entregáveis visíveis.
-- Idempotente e não-destrutivo.

ALTER TABLE public.gd_proposals
ADD COLUMN IF NOT EXISTS esconder_valores BOOLEAN DEFAULT false;
