-- Migration: alinha leads_outlier ao schema esperado pelo dashboard e revenue-ops
--
-- Contexto: leads_outlier foi criada em 20260507103000 sem as colunas tipo_cliente,
-- faixa_consumo, cidade e estado (dados ficaram no JSONB `dados`). Mas o handler do
-- GET /api/dashboard e GET /api/revenue-ops faz SELECT direto dessas colunas,
-- causando erro 42703 (column does not exist) quando o tenant ativo é Outlier.
--
-- Fix: adiciona as 4 colunas como nullable. Auto-create de tenants novos já cria.
-- Médio prazo: dashboard deve ser ajustado pra ler do JSONB `dados` quando coluna
-- for NULL, garantindo dados certos pro Outlier.

ALTER TABLE public.leads_outlier
  ADD COLUMN IF NOT EXISTS tipo_cliente TEXT,
  ADD COLUMN IF NOT EXISTS faixa_consumo TEXT,
  ADD COLUMN IF NOT EXISTS cidade TEXT,
  ADD COLUMN IF NOT EXISTS estado TEXT;
